import { createHash } from "node:crypto";
import type { Hashable } from "@utils/interfaces";

export abstract class AbstractHashable implements Hashable {
    private cachedHashCode?: string;

    /**
     * Hashes the X,Y coordinates
     */
    hashCode(): string {
        if (!this.cachedHashCode) {
            //This is possible because position values are readonly.
            //No need to calculate it every time
            this.cachedHashCode = createHash("md5").update(this.hashString()).digest("hex");
        }

        return this.cachedHashCode;
    }

    protected abstract hashString(): string;
}
