# Relay local file operations contract (selected folder)

Scope
- Applies to local desktop file operations routed via `window.relay` bridge:
  - create_file, append_file, replace_in_file, read_file, list_dir, exists, rename, delete, stat

Boundary rules
1. Allowed root is the user-selected project folder only.
2. Every path argument is interpreted as relative to selected root.
3. Absolute-like paths are rejected:
   - POSIX absolute (`/foo/bar`)
   - UNC-like (`\\server\share`)
   - Windows drive absolute (`C:\foo` or `C:/foo`)
4. Traversal attempts are rejected if they escape root (`../..`).
5. Symlink escape is rejected by realpath checks.

Normalization rules
- Normalize path separators to forward slash (`\` -> `/`) before validation.
- Strip leading `./` for consistency.
- Empty/blank normalized paths are invalid where a concrete file path is required.

Blocked path rules
- Hidden path segments and blocked basenames remain blocked by existing safety policy.

Error taxonomy (normalized for UI and connectors)
- not_found
- permission_denied
- out_of_scope
- binary_unsupported
- size_limit
- already_exists
- invalid_path
- blocked_path
- unknown

Expected behavior examples
- `read_file('src/index.ts')` -> success when file exists in root.
- `read_file('C:\Windows\System32\drivers\etc\hosts')` -> invalid_path.
- `append_file('../outside.txt')` -> out_of_scope.
- `list_dir('\\server\share')` -> invalid_path.

Windows + WSL compatibility expectations
- Backslash input is accepted only as separator in relative paths and normalized.
- Drive-letter absolute input is always rejected.
- Behavior must be deterministic across Windows host folders mounted in WSL and standard Windows paths.

Verification
- E2E coverage validates successful in-scope operations and rejection of out-of-scope/absolute-like inputs.
