import re, sys

BLOCK_START, BLOCK_END = int(sys.argv[1]), int(sys.argv[2])  # 1-indexed inclusive
app = open('src/App.tsx').read().split('\n')
appstart = next(i for i,l in enumerate(app) if l.startswith('export default function App'))
block_text = '\n'.join(app[BLOCK_START-1:BLOCK_END])
prefix = '\n'.join(app[appstart:BLOCK_START-1])

# App top-level locals only (2-space indent)
decl_re = re.compile(r'^  (?:const|let|function)\s+(\[?[A-Za-z_,\s]+\]?|[A-Za-z_][A-Za-z0-9_]*)', re.M)
declared = {}
for m in re.finditer(r'^  const \[([A-Za-z_][A-Za-z0-9_]*), (set[A-Za-z0-9_]*)\] = useState(?:<(.*?)>)?\((.*?)\)', prefix, re.M):
    name, setter, generic, init = m.groups()
    t = generic
    if not t:
        init = init.strip()
        if init in ('true','false'): t = 'boolean'
        elif re.fullmatch(r'-?\d+(\.\d+)?', init): t = 'number'
        elif init.startswith('"') or init.startswith("'") or init.startswith('`'): t = 'string'
        elif init == 'null': t = 'UNKNOWN /* null init */'
        else: t = f'UNKNOWN /* useState({init[:40]}) */'
    declared[name] = t
    declared[setter] = f'Dispatch<SetStateAction<{t}>>' if not t.startswith('UNKNOWN') else 'UNKNOWN /* setter */'
# plain consts with arrow fns: const name = (a: T, b: U) => / useCallback
for m in re.finditer(r'^  const ([A-Za-z_][A-Za-z0-9_]*) = (?:useCallback\()?\(((?:[^()]|\([^()]*\))*)\)(?:: ([A-Za-z<>\[\]| ]+))? =>', prefix, re.M):
    name, params, ret = m.groups()
    declared.setdefault(name, f'({params}) => {ret or "void"}')
# annotated consts: const name: Type =
for m in re.finditer(r'^  const ([A-Za-z_][A-Za-z0-9_]*): ([^=\n]+) =', prefix, re.M):
    declared.setdefault(m.group(1), m.group(2).strip())
# everything else declared at top level -> UNKNOWN
for m in re.finditer(r'^  (?:const|let) ([A-Za-z_][A-Za-z0-9_]*)\b', prefix, re.M):
    declared.setdefault(m.group(1), 'UNKNOWN /* derived */')

idents = set(re.findall(r'\b[a-zA-Z_][A-Za-z0-9_]*\b', block_text))
used = sorted(n for n in idents if n in declared)
print(f"// {len(used)} bindings")
for n in used:
    print(f"  {n}: {declared[n]};")
