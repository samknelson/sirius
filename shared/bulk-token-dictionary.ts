export interface TokenDefinition {
  token: string;
  pattern: RegExp;
  key: string;
  description: string;
  example: string;
}

export const BULK_TOKEN_DICTIONARY: TokenDefinition[] = [
  {
    token: "[FirstName]",
    pattern: /\[FirstName\]/gi,
    key: "firstName",
    description: "Contact's first name",
    example: "Jane",
  },
  {
    token: "[LastName]",
    pattern: /\[LastName\]/gi,
    key: "lastName",
    description: "Contact's last name",
    example: "Smith",
  },
  {
    token: "[DisplayName]",
    pattern: /\[DisplayName\]/gi,
    key: "displayName",
    description: "Contact's display name",
    example: "Jane Smith",
  },
  {
    token: "[Email]",
    pattern: /\[Email\]/gi,
    key: "email",
    description: "Contact's email address",
    example: "jane@example.com",
  },
  {
    token: "[Phone]",
    pattern: /\[Phone\]/gi,
    key: "phone",
    description: "Contact's primary phone number",
    example: "+1 (555) 123-4567",
  },
  {
    token: "[SiriusId]",
    pattern: /\[SiriusId\]/gi,
    key: "siriusId",
    description: "Worker's Sirius ID number",
    example: "10042",
  },
  {
    token: "[SSN]",
    pattern: /\[SSN\]/gi,
    key: "ssn",
    description: "Worker's Social Security Number (masked)",
    example: "***-**-1234",
  },
  {
    token: "[Address]",
    pattern: /\[Address\]/gi,
    key: "address",
    description: "Contact's primary mailing address",
    example: "123 Main St, Boston, MA 02101",
  },
  {
    token: "[Employers]",
    pattern: /\[Employers\]/gi,
    key: "employers",
    description: "Worker's current employer(s)",
    example: "Acme Construction, Beta Corp",
  },
  {
    token: "[BuildingRep]",
    pattern: /\[BuildingRep\]/gi,
    key: "buildingRep",
    description: "Whether the worker is a building rep (steward)",
    example: "Yes — Acme Construction / Local 123",
  },
  {
    token: "[BargainingUnit]",
    pattern: /\[BargainingUnit\]/gi,
    key: "bargainingUnit",
    description: "Worker's bargaining unit name",
    example: "Local 123",
  },
  {
    token: "[CardcheckType]",
    pattern: /\[CardcheckType\]/gi,
    key: "cardcheckType",
    description: "Cardcheck definition name (most recent)",
    example: "Authorization Card",
  },
  {
    token: "[CardcheckStatus]",
    pattern: /\[CardcheckStatus\]/gi,
    key: "cardcheckStatus",
    description: "Cardcheck status (most recent)",
    example: "signed",
  },
  {
    token: "[CardcheckSignedDate]",
    pattern: /\[CardcheckSignedDate\]/gi,
    key: "cardcheckSignedDate",
    description: "Cardcheck signed date (most recent)",
    example: "01/15/2026",
  },
];

export function getTokenDictionary(): Array<{
  token: string;
  description: string;
  example: string;
}> {
  return BULK_TOKEN_DICTIONARY.map(({ token, description, example }) => ({
    token,
    description,
    example,
  }));
}
