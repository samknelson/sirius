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
