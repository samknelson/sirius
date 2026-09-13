export interface CivicOfficial {
  name: string;
  officeName: string;
  level: string;
  division: string;
  party: string | null;
  phones: string[];
  emails: string[];
  photoUrl: string | null;
  urls: string[];
  channels: { type: string; id: string }[];
  ocdDivisionId: string;
}

export class CivicApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public apiErrorCode?: number,
  ) {
    super(message);
    this.name = "CivicApiError";
  }
}