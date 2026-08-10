import * as admin from "firebase-admin";
import "../config/production/env_config";

const serviceAccount: admin.ServiceAccount = {
  projectId: process.env.PROJECT_ID || "manage-lead-crm",
  clientEmail: process.env.CLIENT_EMAIL || "firebase-adminsdk-fbsvc@manage-lead-crm.iam.gserviceaccount.com",
  privateKey: process.env.PRIVATE_KEY?.replace(/\\n/g, "\n") || "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCrsT4iwfDxmGj5\nbKBjcLQC6IZh1MlrglXgKeFGJAZ7kPIsUnIcqjkqYN/c+hgfgNAApLTj97SViEEW\n9EdItnd/KoJ+5w4QEz8HMftsQhSNnQ6UkRMVM5wrTE0twKRNW8Dix5tnymIhyiyE\nM1W7ebJru82oyoRQLGYxAUo4DJOIS0qcpazNDLHOPgDIraPb4mvRoHW+JXJGqOs6\nqhFFVnWXhIh2+Ao/xXZGplUR0eDmZbGZbrWV8UyVtUWO3B3kfiyu5htiDL7DdZik\nWjIWFyAmT54o0ZUtTk+ZFZ4kvBPG9QuLeASr0LY5HSi2gvqzhnwXyUV9k1C2oUxb\nb7v4/pL5AgMBAAECggEACuxGCnfhtbvEnpezVYLk+j65AUOEbqH2XNef6h0zygvf\nkwPKGDpD1Ecg/uHsrnZnZUm/61/wiHHdyDwmxoC7S1G/nHC5M5Bx5P81omkgKHPv\n6pzshJ+0WrR/lX6pGqB7feyv3Z4hzkoFOSzl56fh+sTSMZ/0DoC181NZxC/tTpFM\nRNHXIPP9KpvoX3JG2+3AHyPEiODqqZLzQZuMlc1cEG7SIaL80NAANLSy+gihICf2\nftziYj9MN6HGKwYH5AgQZ23Nvu833spejhhvQwNMfMbrE0q5HrbRR0U03yod/9cB\nyB/xI+PewobqPuIdUJ8N+uFNLefrak4p23JyZosrDQKBgQDiJUCCvIfpumOQ6LJ9\ncNx9XkhcCoww+sjUOxFkVa2aYyNnIgC0fvjB89eMFlvhPeWjtBiBnNPdikFwwJ24\ncJLHU7Pdy3GnEr0uxmYB/+8n81h4BEVuwozlKKaR3NSPkGZ2VU34/+yZP1GSuaiJ\nAqCsqeoiKBd/nO4vhSNrsAiqhQKBgQDCW7UhTA24ey8c9XJC+1X+RySwJujsaYTu\nqRiya4qirbzHw03PD2BrkAiy/Kl0/YxkMXq9tFtcyF/CxEENTg8s4R8QH2qSx8bJ\nDw8Ihd5nF5T5pVxPV/dMpRMUA9AiN5HVrZUtMMY1Ie32jP9FiRFTd7gdcTMPJWbS\n9N3ZlxUC5QKBgQCLuG5aF/d1HdakUlDtFcz0nEriqxWgsWFhVrlRH2pqB7R45NZA\nrm4tDuXuxGWyDVcTRJMbiXSQ3Pm/mxIXQV4+TuXDNA4dJoPCIYwm0iTFryDKzgDE\nBOmeL/ZyClk99f6IP/4zyJM6v5c7qv+I3xm8dCKXReP20VOMAps2zoUcLQKBgFfv\nzmAmXP7fHU3o763Gsf2+iqb4s+JjS7X/5CC175/zI7rubsIEnweLv6PcFX/NSDv8\n9x/l/oBYWJty2EwAyXTw1nEhBcMriJFnstGUYDAcx1a8rqtnjYisF5myr/ULV3xq\ncVhk/QkFNPmcidMYVTKCtFb95LAxp/hCui284dDRAoGBAK9G0f1MsoRfvYg2QE7a\n/3TaBhnR1jrDJmOk3j+JgRvSNunlLx1HCv3LxUbDDaiTyMHScSYqASHs/BkTZMjQ\n6Br/QZ2FNupukThSsaLkv1JijefJvEmnV+ixgRgdZoAWmAjKk8KtXSqp6oTnlYe3\nQ1DYNGg5nwCkRXHhNAa41hF1\n-----END PRIVATE KEY-----\n",

};

// Ensure the Firebase Admin SDK is initialized only once
if (!admin.apps.length) {
  try {
    // Check if the environment variables are correctly loaded
    if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
      throw new Error(
        "Firebase service account environment variables are missing or invalid. Please check PROJECT_ID, CLIENT_EMAIL, and PRIVATE_KEY."
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error);
  }
} else {
  console.log("Firebase Admin SDK already initialized.");
}

// Export the messaging instance
export const messaging = admin.messaging();
