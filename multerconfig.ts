import multer from "multer";
import { Request } from "express";

// Max file size (10MB)
const MAX_SIZE = 50 * 1024 * 1024; // 10MB

// Allowed MIME types
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const ALLOWED_DOC_TYPES = ["application/pdf"];

const ALLOWED_EXCEL_TYPES = [
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv", // .csv
];

const storage = multer.memoryStorage();

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowed = [
    ...ALLOWED_IMAGE_TYPES,
    ...ALLOWED_DOC_TYPES,
    ...ALLOWED_EXCEL_TYPES,
  ];

  if (allowed.includes(file.mimetype)) {
    return cb(null, true);
  }

  return cb(
    new Error(
      "Invalid file type. Allowed: JPEG, PNG, WEBP, PDF, XLS, XLSX, CSV."
    )
  );
};

export const uploadFile = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});
