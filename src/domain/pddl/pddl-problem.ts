import fs from "fs";

export class PddlProblem {
    /**
     * Objects of the problem.
     */
    private readonly objects: string[];

    /**
     * Initial state.
     */
    private readonly init: string[];

    /**
     * Goal.
     */
    private readonly goal: string[];

    constructor(objects: string[], init: string[], goal: string[]) {
        this.objects = objects;
        this.init = init;
        this.goal = goal;
    }

    /**
     * Returns the string formatted pddl-problem.
     */
    public toPDDLString(): string {
        return `(define (problem deliveroo_problem)
        (:domain deliveroo)
        (:objects ${this.objects.join(" ").trim()})
        (:init ${this.init.join(" ").trim()})
        (:goal (and ${this.goal.join(" ").trim()}))
        )`;
    }

    /**
     * Save the pddl problem on file.
     *
     * @param path {string} path where to save the file.
     * @returns {Promise}
     */
    public async toFile(path: string) {
        return new Promise((resolve: Function, reject: Function) => {
            fs.writeFile(path, this.toPDDLString(), (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }
}
