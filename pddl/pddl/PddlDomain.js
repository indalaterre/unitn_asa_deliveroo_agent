import { readFileSync } from "fs";

export class PDDLDomain {

    /**
     * @type {string}
     */
    #pddl_file_path;

    /**
     * @type {string}
     */
    #pddl_domain;

    /**
     * @param {string} pddl_file_path path to the pddl domain file.
     */
    constructor(pddl_file_path){
        this.#pddl_file_path = pddl_file_path;
        this.#pddl_domain = readFileSync(this.#pddl_file_path, "utf-8");
    }

    /**
     * @returns String
     */
    getFilePath(){
        return this.#pddl_file_path;
    }

    /**
     * @returns String
     */
    toPDDLString(){
        return this.#pddl_domain;
    }
}
