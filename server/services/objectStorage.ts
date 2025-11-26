const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(',') || ['public'];
const privateDir = process.env.PRIVATE_OBJECT_DIR || '.private';

function ensureBucketId(): string {
  if (!bucketId) {
    throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID environment variable is not set. Object storage features will not be available.');
  }
  return bucketId;
}

export interface UploadFileOptions {
  fileName: string;
  fileContent: Buffer;
  mimeType?: string;
  accessLevel: 'public' | 'private';
  customPath?: string;
}

export interface FileMetadata {
  fileName: string;
  storagePath: string;
  size: number;
  mimeType?: string;
  lastModified?: Date;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

export class ObjectStorageService {
  async uploadFile(options: UploadFileOptions): Promise<{ storagePath: string; size: number }> {
    const { fileName, fileContent, mimeType, accessLevel, customPath } = options;

    const directory = accessLevel === 'public' ? publicPaths[0] : privateDir;
    const storagePath = customPath || `${directory}/${Date.now()}-${fileName}`;

    // Get signed URL for upload
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900, // 15 minutes
    });

    // Upload file using signed URL
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
      },
      body: fileContent,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    return {
      storagePath,
      size: fileContent.length,
    };
  }

  async downloadFile(storagePath: string): Promise<Buffer> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'GET',
      ttlSec: 900,
    });

    const response = await fetch(signedUrl);
    
    if (!response.ok) {
      throw new Error('File not found or empty');
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deleteFile(storagePath: string): Promise<void> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'DELETE',
      ttlSec: 900,
    });

    const response = await fetch(signedUrl, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.status} ${response.statusText}`);
    }
  }

  async getFileMetadata(storagePath: string): Promise<FileMetadata> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'HEAD',
      ttlSec: 900,
    });

    const response = await fetch(signedUrl, {
      method: 'HEAD',
    });

    if (!response.ok) {
      throw new Error('File not found');
    }

    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    const lastModified = response.headers.get('last-modified');

    return {
      fileName: storagePath.split('/').pop() || storagePath,
      storagePath,
      size: contentLength ? parseInt(contentLength) : 0,
      mimeType: contentType || undefined,
      lastModified: lastModified ? new Date(lastModified) : undefined,
    };
  }

  async generateSignedUrl(storagePath: string, expiresIn: number = 3600): Promise<string> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return await signObjectURL({
      bucketName,
      objectName,
      method: "GET",
      ttlSec: expiresIn,
    });
  }

  async listFiles(prefix?: string): Promise<FileMetadata[]> {
    // Note: Listing files requires database metadata tracking
    // since Replit's sidecar doesn't provide a list endpoint
    // This method should be implemented using the files table
    throw new Error('File listing requires database metadata tracking - use storage.files.list() instead');
  }

  async fileExists(storagePath: string): Promise<boolean> {
    try {
      await this.getFileMetadata(storagePath);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const objectStorageService = new ObjectStorageService();
