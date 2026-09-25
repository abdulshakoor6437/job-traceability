import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SavedFileInfo {
  storageKey: string;
  fullPath: string;
  fileSizeBytes: number;
}

export interface IFileStorage {
  saveFile(fileBuffer: Buffer, extension: string): Promise<SavedFileInfo>;
  readFile(storageKey: string): Promise<Buffer>;
  deleteFile(storageKey: string): Promise<void>;
  fileExists(storageKey: string): Promise<boolean>;
}

export class LocalFileStorage implements IFileStorage {
  private uploadDir: string;

  constructor(customUploadDir?: string) {
    this.uploadDir = customUploadDir || path.resolve(__dirname, '../../../storage/uploads/cvs');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(fileBuffer: Buffer, extension: string): Promise<SavedFileInfo> {
    const cleanExt = extension.startsWith('.') ? extension : `.${extension}`;
    const storageKey = `${crypto.randomUUID()}${cleanExt}`;
    const fullPath = path.join(this.uploadDir, storageKey);

    await fs.promises.writeFile(fullPath, fileBuffer);
    return {
      storageKey,
      fullPath,
      fileSizeBytes: fileBuffer.length,
    };
  }

  async readFile(storageKey: string): Promise<Buffer> {
    const fullPath = path.join(this.uploadDir, path.basename(storageKey));
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in storage: ${storageKey}`);
    }
    return fs.promises.readFile(fullPath);
  }

  async deleteFile(storageKey: string): Promise<void> {
    const fullPath = path.join(this.uploadDir, path.basename(storageKey));
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  async fileExists(storageKey: string): Promise<boolean> {
    const fullPath = path.join(this.uploadDir, path.basename(storageKey));
    return fs.existsSync(fullPath);
  }
}

export const fileStorage: IFileStorage = new LocalFileStorage();
