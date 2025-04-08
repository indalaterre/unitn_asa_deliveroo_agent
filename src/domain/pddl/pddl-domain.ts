import { readFileSync } from "fs";

export class PddlDomain {
    /**
     * Path to the pddl domain file.
     */
    public readonly pddl_file_path: string;

    /**
     * Content of the pddl domain file.
     */
    public readonly pddl_domain: string;

    /**
     * @param {string} pddl_file_path path to the pddl domain file.
     * @param {boolean} read_file reads the file at the path indicated when the object is instantiated.
     */
    constructor(pddl_file_path: string, read_file = true) {
        this.pddl_file_path = pddl_file_path;
        if (read_file) {
            this.pddl_domain = readFileSync(this.pddl_file_path, "utf-8");
        }
    }
}
