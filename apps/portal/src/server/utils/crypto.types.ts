export interface EncryptedSecret {
    ciphertext: string;
    iv: string;
    authTag: string;
}
