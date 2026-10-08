export function modelingCounterValue(body: unknown): number {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !Object.hasOwn(body, 'my_todo_count')) {
    throw new Error('Modeling IDE counter must be a DTO with my_todo_count');
  }
  const raw = (body as Record<string, unknown>).my_todo_count;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+$/.test(raw))) {
    throw new Error('Modeling IDE my_todo_count must be a nonnegative decimal integer');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Modeling IDE my_todo_count must be a safe nonnegative integer');
  }
  return value;
}

// The runtime's AppHub.loadExtensionPlugin requests
// `${baseUrl}/${appId}${remoteModelUrl}/ext/package.json` for every hub
// sub-application and catches the failure with a warn-level log. The backend
// answers 404 when the application has no extension plugin, and the reference
// deployment on 32003 returns the same 404, so this exact manifest path is the
// platform's own "no extension plugin" response rather than a delivery failure.
// The canonical classifier is
// modelingweb/app/scripts/check-source-candidate.mjs; this copy keeps plm-e2e
// runnable on its own and is pinned to it by config-tests. The rule stays
// narrow: only status 404, only this path. Every other response and console
// error remains a failure.
const extensionManifestPattern =
  /^\/api\/[A-Za-z0-9_]+__[A-Za-z0-9_]+\/remotemodel\/ext\/package\.json$/;

export function isExpectedExtensionManifestMiss(item: {
  status: number;
  url: string;
}): boolean {
  if (item.status !== 404) return false;
  try {
    return extensionManifestPattern.test(new URL(item.url).pathname);
  } catch {
    return false;
  }
}

export function isExpectedExtensionManifestConsole(event: {
  message: string;
  source: string;
}): boolean {
  if (!event.message.includes('status of 404')) return false;
  try {
    return extensionManifestPattern.test(new URL(event.source).pathname);
  } catch {
    return false;
  }
}

export function modelingAppIdentity(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Modeling IDE hub must be an application model');
  }
  const model = body as Record<string, unknown>;
  if (typeof model.codeName !== 'string' || model.codeName.toLowerCase() !== 'modeldesign' ||
      typeof model.sysCodeName !== 'string' || model.sysCodeName.toLowerCase() !== 'ibizmodeling') {
    throw new Error('Modeling IDE must load ibizmodeling/ModelDesign, not a PLM fallback');
  }
  return { codeName: model.codeName, sysCodeName: model.sysCodeName };
}
