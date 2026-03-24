const KEY = 'platform.selected_project_id';

export function getSelectedPlatformProjectId(): string {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setSelectedPlatformProjectId(projectId: string) {
  try {
    if (!projectId) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, projectId);
  } catch {
    // ignore
  }
}

