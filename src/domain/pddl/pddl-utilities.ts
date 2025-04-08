import fs from "fs";
import { Directions, type Position } from "@domain/models/environment";

export class PddlPlan {
    public readonly plan: PddlAction[];

    public constructor() {
        this.plan = [];
    }

    public pushAction(pddlAction: PddlAction) {
        this.plan.push(pddlAction);
    }

    public toString(): string {
        return this.plan.join("\n");
    }

    /**
     * Save the pddl problem on file.
     *
     * @param path {string} path where to save the file.
     * @returns {Promise}
     */
    public async toFile(path: string) {
        return new Promise((resolve: Function, reject: Function) => {
            fs.writeFile(path, this.toString(), (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }
}

export class PddlAction {
    /**
     * Direction
     */
    public readonly action: Directions;

    /**
     * Start tile coordinates.
     */
    public readonly from: Position;

    /**
     * Target tile coordinates.
     */
    public readonly to: Position;

    public constructor(action: string, from: Position, to: Position) {
        if (action === "move_up") {
            this.action = Directions.UP;
        } else if (action === "move_down") {
            this.action = Directions.DOWN;
        } else if (action === "move_left") {
            this.action = Directions.LEFT;
        } else if (action === "move_right") {
            this.action = Directions.RIGHT;
        } else {
            // TODO: wath to do? Directon.NONE
        }

        this.from = from;
        this.to = to;
    }

    public toString(): string {
        return `action: ${this.action}, from: ${this.from}, to: ${this.to}`;
    }
}
