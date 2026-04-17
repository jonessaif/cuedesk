declare module "bcryptjs" {
  export function hash(
    value: string,
    saltOrRounds: string | number,
  ): Promise<string>;
  export function hash(
    value: string,
    saltOrRounds: string | number,
    callback: (error: Error | null, encrypted?: string) => void,
  ): void;

  export function compare(value: string, encrypted: string): Promise<boolean>;
  export function compare(
    value: string,
    encrypted: string,
    callback: (error: Error | null, same?: boolean) => void,
  ): void;
}
