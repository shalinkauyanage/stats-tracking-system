// Errors the importer can raise. Each has a short "code" the API/UI can show.

/** The uploaded file is not a usable .xlsx (wrong type, damaged, too big...). */
export class ImportFileError extends Error {
  constructor(message, code = 'bad_file') {
    super(message);
    this.name = 'ImportFileError';
    this.code = code;
  }
}

/** The file was read fine, but the data has problems that must be fixed first. */
export class ImportBlockedError extends Error {
  constructor(message, plan) {
    super(message);
    this.name = 'ImportBlockedError';
    this.code = 'import_blocked';
    this.plan = plan;
  }
}

/** The uploaded file does not match the one that was previewed. */
export class ImportMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportMismatchError';
    this.code = 'file_mismatch';
  }
}
