//! Real-backend e2e harness.
//!
//! When the binary is started with `CAESURA_E2E_HARNESS_PORT=<port>` (and the
//! `e2e-harness` feature compiled in), this module serves the app's real
//! command surface over local HTTP instead of opening a window. Playwright
//! installs a bridge driver (`ui/tests/e2e/support/realTauri.ts`) that forwards
//! every `invoke()` here, so the UI under test talks to the real Rust engine —
//! real serde DTOs, real resolver, real transport, real MIDI queue — closing
//! the parity gap that the mock-backed e2e suite cannot cover.
//!
//! Commands are dispatched through `tauri::test::get_ipc_response` against the
//! same `invoke_handler()` the production app registers, so argument
//! deserialization takes the identical code path as production IPC.
//!
//! Protocol (loopback only, one request per connection):
//! - `POST /invoke` with `{"cmd": "...", "args": {...}}` → command result JSON,
//!   or HTTP 400 with `{"error": <value>}` when the command returns Err.
//! - `GET /health` → `{"ok": true, "midiReady": <bool>}`.
//! - `OPTIONS` → CORS preflight (the Vite origin fetches cross-origin).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use cseq_transport::Transport;
use serde::Deserialize;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tracing::{error, info, warn};

use crate::AppState;

const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
struct InvokePayload {
    cmd: String,
    #[serde(default)]
    args: serde_json::Value,
}

pub fn run(port: u16) {
    let app_state = Arc::new(AppState::new());

    // Machine-local dir: the env override wins (hermetic specs), else a
    // per-port temp dir so parallel harness runs never share autosave or
    // prefs state.
    let machine_dir = if std::env::var("CAESURA_MACHINE_DIR")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
    {
        crate::machine::resolve_machine_dir(None)
    } else {
        std::env::temp_dir().join(format!("caesura-e2e-{port}"))
    };
    let _ = app_state.machine_dir.set(machine_dir.clone());
    let (prefs, source) = crate::machine::load_machine_prefs(&machine_dir);
    crate::machine::migrate_legacy_autosave(&machine_dir);
    *app_state.machine_prefs.lock() = prefs;
    *app_state.machine_prefs_source.lock() = source;

    // Same startup as the production `.setup()` hook: a real transport with a
    // real virtual MIDI port. If MIDI is unavailable (e.g. bare CI runners),
    // commands still work and /health reports midiReady=false so specs can
    // skip playback assertions instead of failing on environment.
    match Transport::start("Dum-Ka MIDI (e2e)") {
        Ok(transport) => {
            info!("e2e harness transport started");
            *app_state.transport.lock() = Some(Arc::new(transport));
        }
        Err(e) => {
            warn!(error = %e, "e2e harness: transport unavailable, serving commands without MIDI");
        }
    }

    let app = tauri::test::mock_builder()
        .manage(app_state.clone())
        .invoke_handler(crate::invoke_handler())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build e2e harness app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build e2e harness webview");

    let listener = TcpListener::bind(("127.0.0.1", port)).expect("failed to bind e2e harness port");
    info!(port, "e2e harness listening on http://127.0.0.1");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(e) = handle_connection(stream, &webview, &app_state) {
                    warn!(error = %e, "e2e harness connection error");
                }
            }
            Err(e) => warn!(error = %e, "e2e harness accept error"),
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    app_state: &Arc<AppState>,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let (method, path, body) = match read_request(&mut stream) {
        Ok(parts) => parts,
        Err(e) => {
            write_response(&mut stream, 400, &format!("{{\"error\":\"{e}\"}}"))?;
            return Ok(());
        }
    };

    match (method.as_str(), path.as_str()) {
        ("OPTIONS", _) => write_response(&mut stream, 204, ""),
        ("GET", "/health") => {
            let midi_ready = app_state.transport.lock().is_some();
            write_response(
                &mut stream,
                200,
                &format!("{{\"ok\":true,\"midiReady\":{midi_ready}}}"),
            )
        }
        ("POST", "/invoke") => {
            let payload: InvokePayload = match serde_json::from_slice(&body) {
                Ok(payload) => payload,
                Err(e) => {
                    let msg =
                        serde_json::json!({ "error": format!("invalid invoke payload: {e}") });
                    return write_response(&mut stream, 400, &msg.to_string());
                }
            };
            let cmd = payload.cmd.clone();
            let response = tauri::test::get_ipc_response(
                webview,
                InvokeRequest {
                    cmd: payload.cmd,
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "http://tauri.localhost".parse().expect("static url"),
                    body: InvokeBody::Json(payload.args),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            );
            match response {
                Ok(InvokeResponseBody::Json(json)) => write_response(&mut stream, 200, &json),
                Ok(InvokeResponseBody::Raw(_)) => {
                    error!(
                        cmd,
                        "e2e harness: raw (non-JSON) command response unsupported"
                    );
                    write_response(
                        &mut stream,
                        500,
                        "{\"error\":\"raw command responses are not supported\"}",
                    )
                }
                Err(value) => {
                    let msg = serde_json::json!({ "error": value });
                    write_response(&mut stream, 400, &msg.to_string())
                }
            }
        }
        _ => write_response(&mut stream, 404, "{\"error\":\"not found\"}"),
    }
}

/// Minimal HTTP/1.1 request reader: request line, headers, then exactly
/// `Content-Length` body bytes. Loopback test traffic only.
fn read_request(stream: &mut TcpStream) -> Result<(String, String, Vec<u8>), String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read(&mut byte) {
            Ok(0) => return Err("connection closed mid-request".to_string()),
            Ok(_) => head.push(byte[0]),
            Err(e) => return Err(format!("read error: {e}")),
        }
        if head.len() > 64 * 1024 {
            return Err("request head too large".to_string());
        }
    }

    let head_text = String::from_utf8_lossy(&head);
    let mut lines = head_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value
                    .trim()
                    .parse()
                    .map_err(|e| format!("bad content-length: {e}"))?;
            }
        }
    }
    if content_length > MAX_BODY_BYTES {
        return Err("request body too large".to_string());
    }

    let mut body = vec![0u8; content_length];
    stream
        .read_exact(&mut body)
        .map_err(|e| format!("body read error: {e}"))?;
    Ok((method, path, body))
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: content-type\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())
}
