const FILE_INTENT_PATTERNS: RegExp[] = [
  /\b(what files|which files|list files|show files|files in (there|this|that|the folder|the directory))\b/i,
  /\b(list|show|open|read|inspect|create|write|append|edit|update|rename|move|delete)\b.{0,40}\b(file|folder|directory|path|paths|repo|project)\b/i,
  /\b(contents of|tree of|directory listing|folder listing)\b/i,
];

function promptLikelyNeedsLocalFileActions(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized) {
    return false;
  }

  return FILE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildCoworkResponseInstruction(userPrompt: string, workingFolder: string): string {
  const hasWorkingFolder = workingFolder.trim().length > 0;
  const needsFileActions = promptLikelyNeedsLocalFileActions(userPrompt);

  const shared = [
    'Respond in normal assistant prose by default.',
    'When local project file access is needed, use a JSON code block with relay_actions and keep paths relative to the working folder unless an absolute path is explicitly required.',
  ];

  if (!hasWorkingFolder) {
    return [
      ...shared,
      'If no working folder is set, state that a project root is required before local file actions can run.',
    ].join(' ');
  }

  if (needsFileActions) {
    return [
      ...shared,
      'This request needs local file access, so produce relay_actions for the required file operations.',
      'Do not claim you lack filesystem access while a working folder is available.',
    ].join(' ');
  }

  return [
    ...shared,
    'If a file operation fails, report the concrete operation error instead of claiming no filesystem access.',
  ].join(' ');
}
