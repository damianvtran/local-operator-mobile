import type { PrivateDataKey } from "./storage";

export interface PrivateDataKeys {
	read(): Promise<PrivateDataKey | null>;
	write(value: PrivateDataKey): Promise<void>;
	clear(): Promise<void>;
}
let storage: PrivateDataKeys | null = null;
export function configurePrivateDataKeys(value: PrivateDataKeys): void {
	storage = value;
}
export function privateDataKeys(): PrivateDataKeys {
	if (!storage) throw new Error("private key storage is not configured");
	return storage;
}
