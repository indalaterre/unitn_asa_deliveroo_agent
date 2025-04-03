import fs from 'fs';

export class PDDLProblem {

    /**
     * @type {[string]}
     */
    #objects;

    /**
     * @type {[string]}
     */
    #init;

    /**
     * @type {[string]}
     */
    #goal;

    /**
     * 
     * @param {[string]} objects 
     * @param {[string]} init 
     * @param {[string]} goal 
     */
    constructor(objects, init, goal){
        this.#objects = objects;
        this.#init = init;
        this.#goal = goal;
    }

    /**
     * @returns {string}
     */
    toPDDLString(){
        return `(define (problem deliveroo_problem)
        (:domain deliveroo)
        (:objects ${this.#objects.join(" ").trim()})
        (:init ${this.#init.join(" ").trim()})
        (:goal (and ${this.#goal.join(" ").trim()}))
        )`;
    }

    async toFile(path){
        return new Promise((resolve, reject) => {
            fs.writeFile(path, this.toPDDLString(), (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }
}


