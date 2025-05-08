import { privateDecrypt, publicEncrypt } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { CryptoConfiguration } from "@domain/models/configurations";

export class Cipher {
    /**
     * The private key used to encrypt the messaged
     */
    publicKey: string;

    /**
     * The private key used to decrypt the messages
     */
    privateKey: string;

    constructor(config: CryptoConfiguration) {
        this.publicKey = fs.readFileSync(path.resolve(config.publicPath), "utf8");
        this.privateKey = fs.readFileSync(path.resolve(config.privatePath), "utf8");
    }

    encrypt(message: string): string {
        const buffer = Buffer.from(message, "utf8");
        return publicEncrypt(this.publicKey, buffer).toString("base64");
    }

    decrypt(encryptedMessage: string): string {
        const buffer = Buffer.from(encryptedMessage, "utf8");
        return privateDecrypt(this.privateKey, buffer).toString("utf8");
    }

    encryptObject(obj: any): string {
        return this.encrypt(JSON.stringify(obj));
    }

    decryptObject<T>(encryptedMessage: string): T {
        const decrypted = this.decrypt(encryptedMessage);
        return JSON.parse(decrypted) as T;
    }
}
