import type { Express } from "express";
import type { IStorage } from "../storage/database";
import { insertEsigSchema, insertFileSchema } from "@shared/schema";
import { objectStorageService } from "../services/objectStorage";
import multer from "multer";
import officeParser from "officeparser";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for documents
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and Word documents are allowed"));
    }
  },
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  if (paragraphs.length === 0) {
    return "<p>" + escapeHtml(text) + "</p>";
  }
  return paragraphs
    .map(p => "<p>" + escapeHtml(p.trim()).replace(/\n/g, "<br>") + "</p>")
    .join("\n");
}

export function registerEsigsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  storage: IStorage
) {
  app.post("/api/esigs", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const replitUserId = user?.claims?.sub;
      if (!replitUserId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const body = { ...req.body, userId: dbUser.id };
      
      if (body.signedDate && typeof body.signedDate === "string") {
        body.signedDate = new Date(body.signedDate);
      }
      
      const parsed = insertEsigSchema.safeParse(body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid esig data", errors: parsed.error.errors });
      }
      
      const esig = await storage.esigs.createEsig(parsed.data);
      res.status(201).json(esig);
    } catch (error: any) {
      console.error("Failed to create esig:", error);
      res.status(500).json({ message: "Failed to create esig" });
    }
  });

  app.post("/api/esigs/upload-document", requireAuth, requirePermission("workers.manage"), upload.single("file"), async (req, res) => {
    try {
      const user = req.user as any;
      const replitUserId = user?.claims?.sub;
      
      if (!replitUserId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

      // Extract text from document using officeparser
      let extractedText: string;
      try {
        extractedText = await officeParser.parseOfficeAsync(req.file.buffer);
      } catch (parseError) {
        console.error("Failed to parse document:", parseError);
        return res.status(400).json({ message: "Failed to extract text from document. Please ensure the file is a valid PDF or Word document." });
      }

      if (!extractedText || extractedText.trim().length === 0) {
        return res.status(400).json({ message: "No text content could be extracted from the document." });
      }

      // Convert extracted text to HTML
      const docRender = textToHtml(extractedText);

      // Upload to object storage in "esigs" folder
      const uploadResult = await objectStorageService.uploadFile({
        fileName: req.file.originalname,
        fileContent: req.file.buffer,
        mimeType: req.file.mimetype,
        accessLevel: "private",
        customPath: `private/esigs/${Date.now()}-${req.file.originalname}`,
      });

      // Create file record in files table
      const fileData = {
        fileName: req.file.originalname,
        storagePath: uploadResult.storagePath,
        mimeType: req.file.mimetype,
        size: uploadResult.size,
        uploadedBy: dbUser.id,
        entityType: "esig",
        entityId: null,
        accessLevel: "private",
        metadata: { extractedTextLength: extractedText.length },
      };

      const validatedFileData = insertFileSchema.parse(fileData);
      const file = await storage.files.create(validatedFileData);

      res.status(201).json({
        fileId: file.id,
        fileName: file.fileName,
        docRender,
      });
    } catch (error: any) {
      console.error("Failed to upload document:", error);
      res.status(500).json({ message: error.message || "Failed to upload document" });
    }
  });

  app.get("/api/esigs/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const esig = await storage.esigs.getEsigById(id);
      
      if (!esig) {
        return res.status(404).json({ message: "E-signature not found" });
      }
      
      res.json(esig);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch esig" });
    }
  });

  app.post("/api/cardcheck/:id/sign", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id: cardcheckId } = req.params;
      const user = req.user as any;
      const replitUserId = user?.claims?.sub;
      
      if (!replitUserId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const existingCardcheck = await storage.cardchecks.getCardcheckById(cardcheckId);
      if (!existingCardcheck) {
        return res.status(404).json({ message: "Cardcheck not found" });
      }

      if (existingCardcheck.status === "signed") {
        return res.status(400).json({ message: "Cardcheck is already signed" });
      }

      if (existingCardcheck.status === "revoked") {
        return res.status(400).json({ message: "Cannot sign a revoked cardcheck" });
      }

      const { docRender, esigData, signatureType, docType = "cardcheck" } = req.body;

      if (!docRender || !esigData) {
        return res.status(400).json({ message: "Missing required signing data" });
      }

      const result = await storage.esigs.signCardcheck({
        cardcheckId,
        userId: dbUser.id,
        docRender,
        docType,
        esigData,
        signatureType,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Failed to sign cardcheck:", error);
      res.status(500).json({ message: "Failed to sign cardcheck" });
    }
  });
}
