import { createHash } from "node:crypto";
import type { Hashable } from "@utils/interfaces";

/**
 * Enumerates the possible directions
 */
export enum Directions {
    UP = "up",
    DOWN = "down",
    LEFT = "left",
    RIGHT = "right",

    NONE = "none",
}

export enum TileType {
    NON_WALKABLE = 0,
    SPAWN = 1,
    DELIVERY = 2,
    WALKABLE = 3,
}

/**
 * Models a tile (the map unit component)
 */
export class Tile implements Hashable {
    /**
     * @param position the tile position
     * @param delivery TRUE if the tile is a delivery position
     * @param walkable TRUE if the tile is walkable
     * @param spawner  TRUE if the tile is dedicated to parcel spawning
     */
    constructor(
        public readonly spawner: boolean,
        public readonly delivery: boolean,
        public readonly walkable: boolean,
        public readonly position: Position,
    ) {}

    /**
     * ToString method
     */
    public toString(): string {
        return `Position: ${this.position}, is delivery: ${this.delivery}, is spawner: ${this.spawner}`;
    }

    /**
     * The hashCode method
     */
    public hashCode(): string {
        return this.position?.hashCode();
    }
}

/**
 * Models a position in the map implementing some utility methods
 */
export class Position implements Hashable {
    private cachedHashCode: string;

    public readonly row: number;
    public readonly column: number;

    /**
     * @param row       the rows coordinate
     * @param column    the columns coordinate
     */
    constructor(row: number, column: number) {
        // Fix row position
        let new_row: number;
        if (row > Math.floor(row) && row < Math.floor(row) + 0.5) {
            new_row = Math.floor(row);
        } else if (row > Math.floor(row) && row > Math.floor(row) + 0.5) {
            new_row = Math.ceil(row);
        } else {
            new_row = row;
        }

        // Fix column position
        let new_column: number;
        if (column > Math.floor(column) && column < Math.floor(column) + 0.5) {
            new_column = Math.floor(column);
        } else if (column > Math.floor(column) && column > Math.floor(column) + 0.5) {
            new_column = Math.ceil(column);
        } else {
            new_column = column;
        }

        this.row = new_row;
        this.column = new_column;
    }

    /**
     * Computes the manhattan distance between this position and the other position.
     * @param from  the starting position
     * @param to    the goal destination
     * @returns The manhattan distance between this position and the other position.
     */
    static manhattanDistance(from: Position, to: Position): number {
        return from.manhattanDistance(to);
    }

    /**
     * @param other the position to compare
     * @returns TRUE if the two positions share same rows/columns coordinates
     */
    equals(other: Position): boolean {
        return this.row === other?.row && this.column === other?.column;
    }

    /**
     * Hashes the X,Y coordinates
     */
    hashCode(): string {
        if (!this.cachedHashCode) {
            //This is possible because position values are readonly.
            //No need to calculate it every time
            this.cachedHashCode = createHash("md5")
                .update(`${this.row},${this.column}`)
                .digest("hex");
        }

        return this.cachedHashCode;
    }

    /**
     * Computes the manhattan distance between this position and the other position.
     * @param other The other position.
     * @returns The manhattan distance between this position and the other position.
     */
    manhattanDistance(other: Position): number {
        return Math.abs(this.row - other.row) + Math.abs(this.column - other.column);
    }

    toString(): string {
        return `X: ${this.row}; Y: ${this.column}`;
    }

    /**
     * Serializes the position into a PDDL string
     */
    public toPddlString(): string {
        return `${this.row}_${this.column}`;
    }

    /**
     * Transform a PDDL position string into an object
     * @param pddlPosition  the string to convert
     */
    static fromPddlString(pddlPosition: string): Position {
        if (!pddlPosition) return null;

        const positionParts: string[] = pddlPosition.split("_");
        return positionParts?.length < 2
            ? null
            : new Position(Number(positionParts[0]), Number(positionParts[1]));
    }

    /**
     * @returns The position of the selected direction is taken
     */
    moveTo(direction: Directions): Position {
        switch (direction) {
            case Directions.UP:
                return new Position(this.row, this.column + 1);
            case Directions.DOWN:
                return new Position(this.row, this.column - 1);
            case Directions.LEFT:
                return new Position(this.row - 1, this.column);
            case Directions.RIGHT:
                return new Position(this.row + 1, this.column);
            default:
                return new Position(this.row, this.column);
        }
    }

    /**
     * @param to    the goal position
     * @returns     the direction the move must follow to reach the goal position
     */
    getDirection(to: Position): Directions | null {
        const dx = to.row - this.row;
        const dy = to.column - this.column;

        if (dx === 0 && dy === 1) return Directions.UP;
        if (dx === 0 && dy === -1) return Directions.DOWN;
        if (dx === -1 && dy === 0) return Directions.LEFT;
        if (dx === 1 && dy === 0) return Directions.RIGHT;

        return null; // not a direct neighbor
    }

    /**
     * @returns The positions of all available moves (no matter if reachable or not)
     */
    get adjacent(): Position[] {
        return [
            this.moveTo(Directions.UP),
            this.moveTo(Directions.DOWN),
            this.moveTo(Directions.LEFT),
            this.moveTo(Directions.RIGHT),
        ];
    }

    /**
     * Deserializes the object considering the [rows,columns] format
     * @param serialized    the string to be deserialized
     */
    public static deserialize(serialized: string): Position {
        const split: string[] = serialized.split(",");
        if (split.length !== 2) {
            throw new RangeError(
                `Unrecognized position. Missing Rows/Columns components: ${serialized}`,
            );
        }

        const [row, column] = split.map((value: string) => Number.parseInt(value, 10));
        return new Position(row, column);
    }
}
