import { googleOAuthClientId, hasGoogleOAuthClient, requestGoogleAccessToken } from "./googleAuth";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_KEY = "healthtracker.driveFolderId";

export type DriveUploadResult = {
  id: string;
  name: string;
  webViewLink?: string;
  thumbnailLink?: string;
};

export type DrivePhotoUploadResult = {
  driveFileId: string;
  webViewLink?: string;
  thumbnail?: string;
  folderId?: string;
};

export function createDrivePhotoClient(options: { clientId: string; folderId?: string }) {
  return {
    async uploadMealPhoto(file: Blob, thumbnail: string): Promise<DrivePhotoUploadResult> {
      const accessToken = await requestDriveToken(options.clientId);
      const folderId = options.folderId ?? (await ensureMealPhotoFolder(accessToken));
      const result = await uploadFile(
        accessToken,
        folderId,
        file,
        `meal-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
      );
      return {
        driveFileId: result.id,
        webViewLink: result.webViewLink,
        thumbnail: result.thumbnailLink ?? thumbnail,
        folderId,
      };
    },
  };
}

export function hasDriveClient(): boolean {
  return hasGoogleOAuthClient();
}

export async function uploadMealPhotoToDrive(file: Blob, fileName: string): Promise<DriveUploadResult> {
  const accessToken = await requestDriveToken();
  const folderId = await ensureMealPhotoFolder(accessToken);
  return uploadFile(accessToken, folderId, file, fileName);
}

async function requestDriveToken(clientId = googleOAuthClientId()): Promise<string> {
  return requestGoogleAccessToken([DRIVE_SCOPE], clientId);
}

async function ensureMealPhotoFolder(accessToken: string): Promise<string> {
  const cached = localStorage.getItem(DRIVE_FOLDER_KEY);
  if (cached) return cached;

  const metadata = {
    name: "Healthtracker Meal Photos",
    mimeType: "application/vnd.google-apps.folder",
  };

  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) throw new Error(`Could not create Drive folder (${response.status}).`);
  const folder = (await response.json()) as { id: string };
  localStorage.setItem(DRIVE_FOLDER_KEY, folder.id);
  return folder.id;
}

async function uploadFile(
  accessToken: string,
  folderId: string,
  file: Blob,
  fileName: string
): Promise<DriveUploadResult> {
  const metadata = {
    name: fileName,
    mimeType: "image/jpeg",
    parents: [folderId],
  };

  const boundary = `healthtracker_${crypto.randomUUID()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body = new Blob(
    [
      delimiter,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      delimiter,
      "Content-Type: image/jpeg\r\n\r\n",
      file,
      closeDelimiter,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,thumbnailLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) throw new Error(`Could not upload meal photo (${response.status}).`);
  return (await response.json()) as DriveUploadResult;
}
