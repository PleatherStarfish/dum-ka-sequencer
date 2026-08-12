//! The Dum-Ka seed notation: weighted proportional trees.
//!
//! A pattern describes one cycle. Each top-level node takes `weight` beats
//! (default 1); a `[ ... ]` group divides its span among its children in
//! proportion to their weights, which is how tuplets of any ratio start
//! anywhere and span any number of nodes (`[x x x x x]@2` is five in the
//! time of two beats). Leaves are onsets (a bare identifier naming a stroke
//! class such as `x`, `dum`, `ka`), rests (`.`), and holds (`_`, which
//! extend the previous event). Sugar: `E(k,n[,r])` expands to a Bjorklund
//! necklace, `*n` repeats the preceding node as siblings, `|` is an ignored
//! visual bar separator, and `#` comments to end of line.
//!
//! Parsing is pure and total: the same text always yields the same tree or
//! the same diagnostic, and diagnostics carry 1-based line/column positions.

use thiserror::Error;

use super::euclid::bjorklund_rotated;

/// Longest accepted pattern text; the patch normalizer mirrors this guard.
pub const MAX_PATTERN_LEN: usize = 4096;
/// Largest weight suffix (`@n`) on any node.
pub const MAX_WEIGHT: u32 = 512;
/// Largest repeat suffix (`*n`).
pub const MAX_REPEAT: u32 = 64;
/// Deepest group nesting.
pub const MAX_DEPTH: usize = 16;
/// Most nodes after sugar expansion.
pub const MAX_NODES: usize = 4096;
/// Largest slot count in `E(k,n[,r])`.
pub const MAX_EUCLID_SLOTS: u32 = 64;

/// A parse diagnostic with a 1-based source position.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("line {line}, column {col}: {message}")]
pub struct PatternError {
    pub line: u32,
    pub col: u32,
    pub message: String,
}

impl PatternError {
    fn new(pos: Pos, message: impl Into<String>) -> Self {
        Self {
            line: pos.line,
            col: pos.col,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Pos {
    line: u32,
    col: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeKind {
    /// A sounding attack carrying a stroke-class label (inert until the
    /// payload milestone; `x` is the conventional generic class).
    Onset { class: String },
    /// Silence for the node's span.
    Rest,
    /// Extends whatever element precedes it in time by this node's span.
    Hold,
    /// A proportional subdivision of this node's span.
    Group(Vec<Node>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub kind: NodeKind,
    /// Relative span within the parent (beats at the top level).
    pub weight: u32,
    pub line: u32,
    pub col: u32,
}

/// A parsed pattern: the top-level siblings of one cycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedTree {
    pub nodes: Vec<Node>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TokenKind {
    LBracket,
    RBracket,
    LParen,
    RParen,
    Comma,
    Dot,
    Underscore,
    At,
    Star,
    Ident(String),
    Int(u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Token {
    kind: TokenKind,
    pos: Pos,
}

fn lex(text: &str) -> Result<Vec<Token>, PatternError> {
    let pattern_len = text.chars().count();
    if pattern_len > MAX_PATTERN_LEN {
        return Err(PatternError::new(
            Pos { line: 1, col: 1 },
            format!("pattern is {pattern_len} characters; the maximum is {MAX_PATTERN_LEN}"),
        ));
    }
    let mut tokens = Vec::new();
    let mut line: u32 = 1;
    let mut col: u32 = 1;
    let mut chars = text.chars().peekable();
    while let Some(&c) = chars.peek() {
        let pos = Pos { line, col };
        match c {
            '\n' => {
                chars.next();
                line += 1;
                col = 1;
            }
            c if c.is_whitespace() => {
                chars.next();
                col += 1;
            }
            '#' => {
                while let Some(&c) = chars.peek() {
                    if c == '\n' {
                        break;
                    }
                    chars.next();
                    col += 1;
                }
            }
            '|' => {
                chars.next();
                col += 1;
            }
            '[' | ']' | '(' | ')' | ',' | '.' | '_' | '@' | '*' => {
                chars.next();
                col += 1;
                let kind = match c {
                    '[' => TokenKind::LBracket,
                    ']' => TokenKind::RBracket,
                    '(' => TokenKind::LParen,
                    ')' => TokenKind::RParen,
                    ',' => TokenKind::Comma,
                    '.' => TokenKind::Dot,
                    '_' => TokenKind::Underscore,
                    '@' => TokenKind::At,
                    _ => TokenKind::Star,
                };
                tokens.push(Token { kind, pos });
            }
            c if c.is_ascii_digit() => {
                let mut value: u64 = 0;
                while let Some(&d) = chars.peek() {
                    if !d.is_ascii_digit() {
                        break;
                    }
                    chars.next();
                    col += 1;
                    value = value * 10 + u64::from(d as u8 - b'0');
                    if value > u64::from(u32::MAX) {
                        return Err(PatternError::new(pos, "number is too large"));
                    }
                }
                tokens.push(Token {
                    kind: TokenKind::Int(value as u32),
                    pos,
                });
            }
            c if c.is_ascii_alphabetic() => {
                let mut ident = String::new();
                while let Some(&d) = chars.peek() {
                    if !d.is_ascii_alphanumeric() {
                        break;
                    }
                    chars.next();
                    col += 1;
                    ident.push(d);
                }
                tokens.push(Token {
                    kind: TokenKind::Ident(ident),
                    pos,
                });
            }
            other => {
                return Err(PatternError::new(
                    pos,
                    format!("unexpected character '{other}'"),
                ));
            }
        }
    }
    Ok(tokens)
}

struct Parser {
    tokens: Vec<Token>,
    index: usize,
    node_count: usize,
    end: Pos,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.index)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.index).cloned();
        if token.is_some() {
            self.index += 1;
        }
        token
    }

    fn here(&self) -> Pos {
        self.peek().map_or(self.end, |t| t.pos)
    }

    fn expect_int(&mut self, what: &str) -> Result<(u32, Pos), PatternError> {
        match self.next() {
            Some(Token {
                kind: TokenKind::Int(value),
                pos,
            }) => Ok((value, pos)),
            Some(token) => Err(PatternError::new(token.pos, format!("expected {what}"))),
            None => Err(PatternError::new(self.end, format!("expected {what}"))),
        }
    }

    fn expect(&mut self, kind: &TokenKind, what: &str) -> Result<Pos, PatternError> {
        match self.next() {
            Some(token) if token.kind == *kind => Ok(token.pos),
            Some(token) => Err(PatternError::new(token.pos, format!("expected {what}"))),
            None => Err(PatternError::new(self.end, format!("expected {what}"))),
        }
    }

    fn count_nodes(&mut self, added: usize, pos: Pos) -> Result<(), PatternError> {
        self.node_count = self.node_count.saturating_add(added);
        if self.node_count > MAX_NODES {
            return Err(PatternError::new(
                pos,
                format!("pattern expands to more than {MAX_NODES} nodes"),
            ));
        }
        Ok(())
    }

    fn parse_siblings(&mut self, depth: usize, in_group: bool) -> Result<Vec<Node>, PatternError> {
        let mut nodes = Vec::new();
        loop {
            match self.peek() {
                None => {
                    if in_group {
                        return Err(PatternError::new(self.end, "unclosed '['"));
                    }
                    return Ok(nodes);
                }
                Some(token) if token.kind == TokenKind::RBracket => {
                    if in_group {
                        self.next();
                        return Ok(nodes);
                    }
                    return Err(PatternError::new(token.pos, "']' without a matching '['"));
                }
                Some(_) => {
                    let mut parsed = self.parse_node(depth)?;
                    nodes.append(&mut parsed);
                }
            }
        }
    }

    fn parse_node(&mut self, depth: usize) -> Result<Vec<Node>, PatternError> {
        let token = self.next().expect("caller peeked");
        let pos = token.pos;
        let kind = match token.kind {
            TokenKind::LBracket => {
                if depth + 1 > MAX_DEPTH {
                    return Err(PatternError::new(
                        pos,
                        format!("groups nest deeper than {MAX_DEPTH} levels"),
                    ));
                }
                let children = self.parse_siblings(depth + 1, true)?;
                if children.is_empty() {
                    return Err(PatternError::new(pos, "empty group '[]'"));
                }
                NodeKind::Group(children)
            }
            TokenKind::Dot => NodeKind::Rest,
            TokenKind::Underscore => NodeKind::Hold,
            TokenKind::Ident(name) => {
                let euclid_call = name == "E"
                    && matches!(
                        self.peek(),
                        Some(Token {
                            kind: TokenKind::LParen,
                            ..
                        })
                    );
                if euclid_call {
                    self.parse_euclid(pos)?
                } else if matches!(
                    self.peek(),
                    Some(Token {
                        kind: TokenKind::LParen,
                        ..
                    })
                ) {
                    return Err(PatternError::new(
                        self.here(),
                        "'(' is only valid after E, as in E(3,8)",
                    ));
                } else {
                    NodeKind::Onset { class: name }
                }
            }
            TokenKind::RBracket => unreachable!("handled by parse_siblings"),
            TokenKind::LParen | TokenKind::RParen | TokenKind::Comma => {
                return Err(PatternError::new(
                    pos,
                    "'(' is only valid after E, as in E(3,8)",
                ));
            }
            TokenKind::At => {
                return Err(PatternError::new(
                    pos,
                    "'@' must follow a note, rest, or group",
                ));
            }
            TokenKind::Star => {
                return Err(PatternError::new(
                    pos,
                    "'*' must follow a note, rest, or group",
                ));
            }
            TokenKind::Int(_) => {
                return Err(PatternError::new(
                    pos,
                    "a number is only valid after '@', '*', or inside E(...)",
                ));
            }
        };

        let mut node = Node {
            kind,
            weight: 1,
            line: pos.line,
            col: pos.col,
        };
        let mut repeat: u32 = 1;
        let mut saw_weight = false;
        let mut saw_repeat = false;
        loop {
            match self.peek().map(|t| t.kind.clone()) {
                Some(TokenKind::At) => {
                    let at = self.next().expect("peeked").pos;
                    if saw_weight {
                        return Err(PatternError::new(at, "duplicate '@' weight"));
                    }
                    saw_weight = true;
                    let (value, vpos) = self.expect_int("a weight after '@'")?;
                    if value == 0 || value > MAX_WEIGHT {
                        return Err(PatternError::new(
                            vpos,
                            format!("weight must be 1-{MAX_WEIGHT}"),
                        ));
                    }
                    node.weight = value;
                }
                Some(TokenKind::Star) => {
                    let star = self.next().expect("peeked").pos;
                    if saw_repeat {
                        return Err(PatternError::new(star, "duplicate '*' repeat"));
                    }
                    saw_repeat = true;
                    let (value, vpos) = self.expect_int("a count after '*'")?;
                    if value == 0 || value > MAX_REPEAT {
                        return Err(PatternError::new(
                            vpos,
                            format!("repeat must be 1-{MAX_REPEAT}"),
                        ));
                    }
                    repeat = value;
                }
                _ => break,
            }
        }

        // Children (including Euclidean sugar) were counted while parsing the
        // node. Count this node once, then count the complete subtree only for
        // each additional repeated copy. This makes MAX_NODES describe the
        // actual expanded tree instead of charging nested children again at
        // every ancestor.
        let repeated_copies = (repeat as usize).saturating_sub(1);
        let added = 1usize.saturating_add(node_size(&node).saturating_mul(repeated_copies));
        self.count_nodes(added, pos)?;
        Ok(vec![node; repeat as usize])
    }

    fn parse_euclid(&mut self, pos: Pos) -> Result<NodeKind, PatternError> {
        self.expect(&TokenKind::LParen, "'(' after E")?;
        let (onsets, _) = self.expect_int("an onset count in E(k,n)")?;
        self.expect(&TokenKind::Comma, "',' in E(k,n)")?;
        let (slots, spos) = self.expect_int("a slot count in E(k,n)")?;
        let rotation = match self.peek().map(|t| t.kind.clone()) {
            Some(TokenKind::Comma) => {
                self.next();
                let (r, _) = self.expect_int("a rotation in E(k,n,r)")?;
                r
            }
            _ => 0,
        };
        self.expect(&TokenKind::RParen, "')' to close E(...)")?;
        if slots == 0 || slots > MAX_EUCLID_SLOTS {
            return Err(PatternError::new(
                spos,
                format!("E(...) slots must be 1-{MAX_EUCLID_SLOTS}"),
            ));
        }
        if onsets > slots {
            return Err(PatternError::new(
                pos,
                format!("E({onsets},{slots}) has more onsets than slots"),
            ));
        }
        self.count_nodes(slots as usize, pos)?;
        let children = bjorklund_rotated(onsets, slots, rotation)
            .into_iter()
            .map(|sounds| Node {
                kind: if sounds {
                    NodeKind::Onset {
                        class: "x".to_string(),
                    }
                } else {
                    NodeKind::Rest
                },
                weight: 1,
                line: pos.line,
                col: pos.col,
            })
            .collect();
        Ok(NodeKind::Group(children))
    }
}

fn node_size(node: &Node) -> usize {
    match &node.kind {
        NodeKind::Group(children) => 1 + children.iter().map(node_size).sum::<usize>(),
        _ => 1,
    }
}

/// Parse a pattern into its seed tree, or the first diagnostic.
pub fn parse(text: &str) -> Result<SeedTree, PatternError> {
    let tokens = lex(text)?;
    let end = {
        let mut line = 1u32;
        let mut col = 1u32;
        for c in text.chars() {
            if c == '\n' {
                line += 1;
                col = 1;
            } else {
                col += 1;
            }
        }
        Pos { line, col }
    };
    let mut parser = Parser {
        tokens,
        index: 0,
        node_count: 0,
        end,
    };
    let nodes = parser.parse_siblings(0, false)?;
    if nodes.is_empty() {
        return Err(PatternError::new(
            Pos { line: 1, col: 1 },
            "empty pattern; write at least one note, e.g. x . x .",
        ));
    }
    Ok(SeedTree { nodes })
}

/// Render a tree in canonical text form: single spaces, explicit weights
/// only when they differ from 1, sugar expanded. `parse(print(t)) == t`.
pub fn print(tree: &SeedTree) -> String {
    let mut out = String::new();
    print_nodes(&tree.nodes, &mut out);
    out
}

fn print_nodes(nodes: &[Node], out: &mut String) {
    for (i, node) in nodes.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        print_node(node, out);
    }
}

fn print_node(node: &Node, out: &mut String) {
    match &node.kind {
        NodeKind::Onset { class } => out.push_str(class),
        NodeKind::Rest => out.push('.'),
        NodeKind::Hold => out.push('_'),
        NodeKind::Group(children) => {
            out.push('[');
            print_nodes(children, out);
            out.push(']');
        }
    }
    if node.weight != 1 {
        out.push('@');
        out.push_str(&node.weight.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn onset(class: &str, weight: u32) -> Node {
        Node {
            kind: NodeKind::Onset {
                class: class.to_string(),
            },
            weight,
            line: 0,
            col: 0,
        }
    }

    /// Strip positions so structural equality ignores where tokens sat.
    fn shape(nodes: &[Node]) -> Vec<(String, u32)> {
        fn walk(nodes: &[Node], depth: usize, out: &mut Vec<(String, u32)>) {
            for node in nodes {
                let label = match &node.kind {
                    NodeKind::Onset { class } => format!("{depth}:{class}"),
                    NodeKind::Rest => format!("{depth}:."),
                    NodeKind::Hold => format!("{depth}:_"),
                    NodeKind::Group(children) => {
                        out.push((format!("{depth}:["), node.weight));
                        walk(children, depth + 1, out);
                        format!("{depth}:]")
                    }
                };
                out.push((label, node.weight));
            }
        }
        let mut out = Vec::new();
        walk(nodes, 0, &mut out);
        out
    }

    #[test]
    fn parses_the_readme_example() {
        let tree = parse("[dum@3 ka] [. ka] [dum ka dum ka dum]@2").unwrap();
        assert_eq!(tree.nodes.len(), 3);
        assert_eq!(tree.nodes[0].weight, 1);
        assert_eq!(tree.nodes[2].weight, 2);
        match &tree.nodes[2].kind {
            NodeKind::Group(children) => assert_eq!(children.len(), 5),
            other => panic!("expected group, got {other:?}"),
        }
        match &tree.nodes[0].kind {
            NodeKind::Group(children) => {
                assert_eq!(children[0].weight, 3);
                assert_eq!(
                    children[0].kind,
                    NodeKind::Onset {
                        class: "dum".to_string()
                    }
                );
            }
            other => panic!("expected group, got {other:?}"),
        }
    }

    #[test]
    fn bars_comments_and_newlines_are_invisible() {
        let with_noise = parse("x . | x .  # tail comment\n| . x").unwrap();
        let plain = parse("x . x . . x").unwrap();
        assert_eq!(shape(&with_noise.nodes), shape(&plain.nodes));
    }

    #[test]
    fn unicode_length_whitespace_and_columns_are_scalar_based() {
        let unicode_space = parse("x\u{85}x").unwrap();
        let plain = parse("x x").unwrap();
        assert_eq!(shape(&unicode_space.nodes), shape(&plain.nodes));

        let bom = parse("x\u{feff}x").unwrap_err();
        assert_eq!((bom.line, bom.col), (1, 2));
        assert_eq!(bom.message, "unexpected character '\u{feff}'");

        let astral = parse("x 😀").unwrap_err();
        assert_eq!((astral.line, astral.col), (1, 3));
        assert_eq!(astral.message, "unexpected character '😀'");

        let at_limit = format!("x #{}", "😀".repeat(MAX_PATTERN_LEN - 3));
        assert!(parse(&at_limit).is_ok());
        let above_limit = format!("{at_limit}😀");
        assert_eq!(
            parse(&above_limit).unwrap_err().message,
            format!(
                "pattern is {} characters; the maximum is {MAX_PATTERN_LEN}",
                MAX_PATTERN_LEN + 1
            )
        );
    }

    #[test]
    fn repeat_expands_to_siblings() {
        let repeated = parse("[x .]*3").unwrap();
        let written = parse("[x .] [x .] [x .]").unwrap();
        assert_eq!(shape(&repeated.nodes), shape(&written.nodes));
        let weighted = parse("x@2*2").unwrap();
        assert_eq!(weighted.nodes.len(), 2);
        assert!(weighted.nodes.iter().all(|n| n.weight == 2));
    }

    #[test]
    fn euclid_sugar_expands_to_the_tresillo() {
        let sugar = parse("E(3,8)").unwrap();
        let spelled = parse("[x . . x . . x .]").unwrap();
        assert_eq!(shape(&sugar.nodes), shape(&spelled.nodes));
        let rotated = parse("E(3,8,3)").unwrap();
        let rotated_spelled = parse("[x . . x . x . .]").unwrap();
        assert_eq!(shape(&rotated.nodes), shape(&rotated_spelled.nodes));
    }

    #[test]
    fn euclid_group_takes_weight() {
        let tree = parse("E(3,8)@2").unwrap();
        assert_eq!(tree.nodes.len(), 1);
        assert_eq!(tree.nodes[0].weight, 2);
    }

    #[test]
    fn plain_e_is_an_ordinary_stroke_class() {
        let tree = parse("E x").unwrap();
        assert_eq!(
            tree.nodes[0].kind,
            NodeKind::Onset {
                class: "E".to_string()
            }
        );
    }

    #[test]
    fn diagnostics_carry_positions() {
        let err = parse("x .\n[x ka@0]").unwrap_err();
        assert_eq!((err.line, err.col), (2, 7));
        assert!(err.message.contains("weight must be 1-"), "{}", err.message);

        let err = parse("[x x").unwrap_err();
        assert_eq!(err.message, "unclosed '['");

        let err = parse("x ]").unwrap_err();
        assert_eq!((err.line, err.col), (1, 3));

        let err = parse("").unwrap_err();
        assert!(err.message.contains("empty pattern"));

        let err = parse("[]").unwrap_err();
        assert!(err.message.contains("empty group"));

        let err = parse("E(9,8)").unwrap_err();
        assert!(err.message.contains("more onsets than slots"));

        let err = parse("x $").unwrap_err();
        assert!(err.message.contains("unexpected character"));

        let err = parse("dum(3,8)").unwrap_err();
        assert!(err.message.contains("only valid after E"));
    }

    #[test]
    fn caps_are_enforced() {
        let deep = format!(
            "{}x{}",
            "[".repeat(MAX_DEPTH + 1),
            "]".repeat(MAX_DEPTH + 1)
        );
        assert!(parse(&deep).unwrap_err().message.contains("nest deeper"));

        let wide = "x*64 ".repeat(65);
        assert!(parse(&wide).unwrap_err().message.contains("more than"));

        // Exactly 4,096 expanded leaves are legal. Nested children are
        // charged once, even though each enclosing group contains them.
        assert!(parse(&"x*64 ".repeat(64)).is_ok());
        let nested = format!(
            "{}x {}{}",
            "[".repeat(MAX_DEPTH),
            "_ ".repeat(239),
            "]".repeat(MAX_DEPTH)
        );
        assert!(parse(&nested).is_ok());

        let long = "x ".repeat(MAX_PATTERN_LEN);
        assert!(parse(&long).unwrap_err().message.contains("characters"));

        assert!(parse("x@513").unwrap_err().message.contains("weight"));
        assert!(parse("x*65").unwrap_err().message.contains("repeat"));
        assert!(parse("E(1,65)").unwrap_err().message.contains("slots"));
    }

    #[test]
    fn print_is_canonical() {
        let tree = SeedTree {
            nodes: vec![
                onset("dum", 3),
                Node {
                    kind: NodeKind::Group(vec![onset("ka", 1), onset("x", 2)]),
                    weight: 2,
                    line: 0,
                    col: 0,
                },
            ],
        };
        assert_eq!(print(&tree), "dum@3 [ka x@2]@2");
    }

    fn leaf_strategy() -> impl Strategy<Value = NodeKind> {
        prop_oneof![
            3 => "[a-z][a-z0-9]{0,3}".prop_map(|class| NodeKind::Onset { class }),
            1 => Just(NodeKind::Rest),
            1 => Just(NodeKind::Hold),
        ]
    }

    fn node_strategy() -> impl Strategy<Value = Node> {
        let leaf = (leaf_strategy(), 1u32..6).prop_map(|(kind, weight)| Node {
            kind,
            weight,
            line: 0,
            col: 0,
        });
        leaf.prop_recursive(3, 24, 4, |inner| {
            (proptest::collection::vec(inner, 1..5), 1u32..6).prop_map(|(children, weight)| Node {
                kind: NodeKind::Group(children),
                weight,
                line: 0,
                col: 0,
            })
        })
    }

    proptest! {
        #[test]
        fn print_then_parse_round_trips(nodes in proptest::collection::vec(node_strategy(), 1..5)) {
            let tree = SeedTree { nodes };
            let printed = print(&tree);
            let reparsed = parse(&printed).unwrap();
            prop_assert_eq!(shape(&reparsed.nodes), shape(&tree.nodes));
            // Printing the reparse must be a fixed point.
            prop_assert_eq!(print(&reparsed), printed);
        }
    }
}
