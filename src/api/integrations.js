import './localDb.js';

const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

export const Core = db.integrations.Core;

export const InvokeLLM = db.integrations.Core.InvokeLLM;

export const SendEmail = db.integrations.Core.SendEmail;

export const SendSMS = db.integrations.Core.SendSMS;

export const UploadFile = db.integrations.Core.UploadFile;

export const GenerateImage = db.integrations.Core.GenerateImage;

export const ExtractDataFromUploadedFile = db.integrations.Core.ExtractDataFromUploadedFile;
