import { createHash } from "node:crypto";

export class IdAware {
    constructor(protected _id: string) {}

    /**
     * TRUE if the two classes have the same id
     * @param other the other classes
     */
    equals(other: IdAware): boolean {
        return other._id === this._id;
    }

    /**
     * Hashes the id
     */
    hashCode(): string {
        return createHash("md5").update(this._id).digest("hex");
    }

    /**
     * Prints information about the class
     */
    toString(): string {
        return this._id;
    }

    /**
     * @returns the id
     */
    serialize(): string {
        return this._id;
    }
}
