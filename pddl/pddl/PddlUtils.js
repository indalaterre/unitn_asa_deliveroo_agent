
export const mapPddlActionToDeliverooAction = new Map();
mapPddlActionToDeliverooAction.set("move_up", "up");
mapPddlActionToDeliverooAction.set("move_down", "down");
mapPddlActionToDeliverooAction.set("move_left", "left");
mapPddlActionToDeliverooAction.set("move_right", "right");

export const Direction = Object.freeze({
    ABOVE: "above",
    BELOWE: "belowe",
    LEFT: "left",
    RIGHT: "right",
});

export class PDDLTile {

    /**
     * Row.
     * 
     * @type {number}
     */
    x_position;

    /**
     * Column.
     * 
     * @type {number}
     */
    y_position;


    /**
     * Column.
     * 
     * @type {Map<string, PDDLTile>}
     */
    neighbors;

    /**
     * 
     * @param {number} row.
     * @param {number} column.
     */
    constructor(row, column) {
        this.x_position = row;
        this.y_position = column;
        this.neighbors = new Map();
    }

    /**
     * @param {string} direction
     * @param {PDDLTile} pddlTile
     */
    setNeighbour(direction, pddlTile){
        this.neighbors.set(direction, pddlTile);
    }

    /**
     * @returns {string}
     */
    getPosition(){
        return `${this.x_position}_${this.y_position}`
    }

    /**
     * @returns {string}
     */
    toPDDLString(){
        return `tile_${this.getPosition()}`;
    }
}
