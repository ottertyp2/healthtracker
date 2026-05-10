type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string }) => void;
      }) => TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

export function googleOAuthClientId(): string {
  return import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID || "";
}

export function hasGoogleOAuthClient(): boolean {
  return Boolean(googleOAuthClientId());
}

export async function requestGoogleAccessToken(scopes: string[], clientId = googleOAuthClientId()): Promise<string> {
  if (!clientId) throw new Error("Google OAuth Client ID fehlt.");
  if (scopes.length === 0) throw new Error("Google OAuth Scope fehlt.");
  await loadGoogleIdentity();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google?.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(" "),
      callback: (response) => {
        if (response.error || !response.access_token) reject(new Error(response.error ?? "Google Login fehlgeschlagen."));
        else resolve(response.access_token);
      },
    });

    tokenClient?.requestAccessToken({ prompt: "" });
  });
}

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google Identity Services konnte nicht geladen werden.")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services konnte nicht geladen werden."));
    document.head.appendChild(script);
  });
}
