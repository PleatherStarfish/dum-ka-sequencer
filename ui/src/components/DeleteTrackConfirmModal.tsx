/**
 * Track deletion confirmation with optional save-before-delete.
 * Extracted from App.tsx (carve-up round 21) along the panel seam — all
 * state stays in App and arrives via props with their original names (types
 * compiler-generated via scripts/carve/typegen.cjs); the JSX body is
 * unchanged.
 */
import {
  TrackCycleLengthMode,
  TrackTempoMode,
} from "../patchIo";
import {
  ModalFrame,
  ModalHeader,
} from "./ModalChrome";

export interface DeleteTrackConfirmModalProps {
  handleExportTrack: (trackId: string) => Promise<void>;
  handleRemoveParallelTrack: (trackId: string) => Promise<void>;
  pendingDeleteTrack: { id: string; name: string; color: string; muted: boolean; soloed: boolean; tempoMode: TrackTempoMode; customTempoBpm: number; tempoBadge: string | null; cycleLengthMode: TrackCycleLengthMode; customCycleBeats: number; midiChannels: number[]; inspectableMidiChannels: number[]; channelHocketEnabled: boolean; triggered: boolean; } | null;
  pendingDeleteTrackLabel: string;
  pendingDeleteTrackName: string;
  setPendingDeleteTrackId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function DeleteTrackConfirmModal({
  handleExportTrack,
  handleRemoveParallelTrack,
  pendingDeleteTrack,
  pendingDeleteTrackLabel,
  pendingDeleteTrackName,
  setPendingDeleteTrackId,
}: DeleteTrackConfirmModalProps) {
  return (
      <ModalFrame
        open={Boolean(pendingDeleteTrack)}
        onClose={() => setPendingDeleteTrackId(null)}
        ariaLabelledby="track-delete-title"
        className="setup-backdrop track-delete-backdrop"
        layer="utility"
        size="compact"
        surfaceClassName="setup-dialog track-delete-dialog"
      >
        {({ close }) =>
          pendingDeleteTrack ? (
            <>
              <ModalHeader
                className="setup-head"
                title={`Delete ${pendingDeleteTrackLabel}`}
                titleId="track-delete-title"
                eyebrow={pendingDeleteTrackName}
                closeLabel="Cancel track deletion"
                onClose={close}
              />
            <p className="track-delete-message">
              Are you sure you want to delete this track?
            </p>
            <div className="track-delete-actions">
              <button
                className="tiny-button"
                type="button"
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="tiny-button"
                type="button"
                onClick={() => void handleExportTrack(pendingDeleteTrack.id)}
              >
                Save track
              </button>
              <button
                className="tiny-button is-destructive"
                type="button"
                onClick={() => void handleRemoveParallelTrack(pendingDeleteTrack.id)}
              >
                Delete track
              </button>
            </div>
            </>
          ) : null
        }
      </ModalFrame>
  );
}
