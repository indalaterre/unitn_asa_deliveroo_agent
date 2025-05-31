import {
    constants,
    createCipheriv,
    createDecipheriv,
    privateDecrypt,
    publicEncrypt,
    randomBytes,
} from "node:crypto";
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
        console.log("Cipher initialized with keys");
    }

    encrypt(message: string): string {
        // 1. Generate a random AES key and IV
        const aesKey = randomBytes(32); // 256-bit key
        const iv = randomBytes(16); // 128-bit IV

        // 2. Encrypt the message using AES
        const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
        let encryptedMessage = cipher.update(message, "utf8", "base64");
        encryptedMessage += cipher.final("base64");

        // 3. Encrypt the AES key using RSA
        const encryptedKey = publicEncrypt(
            {
                key: this.publicKey,
                padding: constants.RSA_PKCS1_OAEP_PADDING,
            },
            aesKey,
        ).toString("base64");

        // 4. Package encrypted AES key, IV, and encrypted message into a single base64 string
        const payload = {
            key: encryptedKey,
            iv: iv.toString("base64"),
            data: encryptedMessage,
        };

        return Buffer.from(JSON.stringify(payload)).toString("base64");
    }

    decrypt(encryptedPayload: string): string {
        try {
            // 1. Decode the base64 payload and parse it
            const payloadStr = Buffer.from(encryptedPayload, "base64").toString("utf8");
            const { key, iv, data } = JSON.parse(payloadStr);

            // 2. Decrypt the AES key using the RSA private key
            const aesKey = privateDecrypt(
                {
                    key: this.privateKey,
                    padding: constants.RSA_PKCS1_OAEP_PADDING,
                },
                Buffer.from(key, "base64"),
            );

            // 3. Decrypt the message using the decrypted AES key and IV
            const decipher = createDecipheriv("aes-256-cbc", aesKey, Buffer.from(iv, "base64"));
            let decrypted = decipher.update(data, "base64", "utf8");
            decrypted += decipher.final("utf8");

            return decrypted;
        } catch (err) {
            console.error("Decryption failed:", err);
            return null;
        }
    }

    encryptObject(obj: any): string {
        // Encrypt a JavaScript object by first converting it to a JSON string
        return this.encrypt(JSON.stringify(obj));
    }

    decryptObject<T>(encryptedMessage: string): T {
        // Decrypt the message and parse it back to the original object
        const decrypted: string = this.decrypt(encryptedMessage);
        return JSON.parse(decrypted) as T;
    }
}
