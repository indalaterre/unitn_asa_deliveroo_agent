import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { PDDLProblem } from "./pddl/PddlProblem.js"
import { onlineSolver } from "./pddl/PddlOnlineSolver.js"
import { PDDLDomain } from "./pddl/PddlDomain.js";
import { mapPddlActionToDeliverooAction, PDDLTile, Direction } from "./pddl/PddlUtils.js";

// PDDL domain
const pddlDomain = new PDDLDomain("./src/pddl/domain.pddl")

const client = new DeliverooApi(
    'http://127.0.0.1:8080',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Ijg3ZWE5MmYzYzg4IiwibmFtZSI6Ik1hcmNvIiwiaWF0IjoxNzQzMjY1NjU0fQ.dR70ExtXWH7P0uIbs8I-7oeR9K0sRLD1hKefFWGMhkk'
)

function distance( {x:x1, y:y1}, {x:x2, y:y2}) {
    const dx = Math.abs( Math.round(x1) - Math.round(x2) )
    const dy = Math.abs( Math.round(y1) - Math.round(y2) )
    return dx + dy;
}

var AGENTS_OBSERVATION_DISTANCE
var MOVEMENT_DURATION
var PARCEL_DECADING_INTERVAL
client.onConfig( (config) => {
    AGENTS_OBSERVATION_DISTANCE = config.AGENTS_OBSERVATION_DISTANCE;
    MOVEMENT_DURATION = config.MOVEMENT_DURATION;
    PARCEL_DECADING_INTERVAL = config.PARCEL_DECADING_INTERVAL == '1s' ? 1000 : 1000000;
} );

const delivery_tiles = []

/**
 * Mappa dell'ambiente.
 */
const map = {
    width:undefined,
    height:undefined,

    /**
     * @type {Map<String, PDDLTile>}
     */
    tiles: new Map(),

    add: function ( tile ) {
        const new_tile = new PDDLTile(tile.x, tile.y);
        return this.tiles.set(new_tile.getPosition(), new_tile);
    },

    /**
     * 
     * @param {Number} x 
     * @param {Number} y 
     * @returns {PDDLTile}
     */
    xy: function (x, y) {
        return this.tiles.get(`${x}_${y}`)
    }
};
client.onMap( (width, height, tiles) => {
    map.width = width;
    map.height = height;

    for (const t of tiles) {
        map.add( t );
        if (t.delivery){
            delivery_tiles.push(t)
        }
    }

    // Set the neighbours
    for (const pddlTile of map.tiles.values()){
        const x_position = pddlTile.x_position;
        const y_position = pddlTile.y_position;

        const above_neighbour = map.xy(x_position, y_position+1);
        if (above_neighbour){
            pddlTile.setNeighbour(Direction.ABOVE, above_neighbour);
        }

        const below_neighbour = map.xy(x_position, y_position-1);
        if (below_neighbour){
            pddlTile.setNeighbour(Direction.BELOWE, below_neighbour);
        }

        const left_neighbour = map.xy(x_position-1, y_position);
        if (left_neighbour){
            pddlTile.setNeighbour(Direction.LEFT, left_neighbour);
        }

        const right_neighbour = map.xy(x_position+1, y_position);
        if (right_neighbour){
            pddlTile.setNeighbour(Direction.RIGHT, right_neighbour);
        }
    }

    console.log(delivery_tiles)
} )
client.onTile( (x, y, delivery) => {
    map.add( {x, y, delivery} );
} )

/**
 * Informazioni sull'agente.
 */
const me = {};
client.onYou( ( {id, name, x, y, score} ) => {
    me.id = id;
    me.name = name;
    me.x = x;
    me.y = y;
    me.score = score;
} )

const otherAgents = new Map();
client.onAgentsSensing( ( agents ) => {

    for (const agent of agents){

        // Aggiusto lo spostamento in x
        if (agent.x > Math.floor(agent.x) && agent.x < (Math.floor(agent.x) + 0.5)){
            agent.x = Math.floor(agent.x)
        } else if (agent.x > Math.floor(agent.x) && agent.x > (Math.floor(agent.x) + 0.5)) {
            agent.x = Math.ceil(agent.x)
        }
        // Aggiusto lo spostamento in y
        if (agent.y > Math.floor(agent.y) && agent.y < (Math.floor(agent.y) + 0.5)){
            agent.y = Math.floor(agent.y)
        } else if (me.y > Math.floor(agent.y) && agent.y > (Math.floor(agent.y) + 0.5)) {
            agent.y = Math.ceil(agent.y)
        }

        otherAgents.set(agent.id, agent);
    }

} )

// variabile utilizzata per non sovrascrivere ciò che l'agente sta facendo
let already_managing = false

/**
 * Esegue il movimento verso il target che deve possedere i campi x e y.
 * @param {*} target 
 */
async function SimpleMove(target){

    console.log(`Move from (${me.x}, ${me.y}) to (${target.x}, ${target.y})`)

    while (me.x != target.x || me.y != target.y){
        if ( me.x < target.x )  // Se la mia posizione in x è minore rispetto a quella richiesta
            await client.emitMove('right');  // Richiedo uno spostamento verso destra
        else if ( me.x > target.x )  // Se la mia posizione in x è maggiore rispetto a quella richiesta
            await client.emitMove('left');  // Richiedo uno spostamento verso sinistra

        // Controllo la posizione in y
        if ( me.y < target.y )  // Se la mia posizione in y è minore rispetto a quella richiesta
            await client.emitMove('up');  // Richiedo uno spostamento verso l'alto
        else if ( me.y > target.y )  // Se la mia posizione in x è maggiore rispetto a quella richiesta
            await client.emitMove('down');  // Richiedo uno spostamento verso il basso

        // Postpone next iteration at setImmediate
        await new Promise( res => setImmediate( res ) );

        // Aggiusto lo spostamento in x
        if (me.x > Math.floor(me.x) && me.x < (Math.floor(me.x) + 0.5)){
            me.x = Math.floor(me.x)
        } else if (me.x > Math.floor(me.x) && me.x > (Math.floor(me.x) + 0.5)) {
            me.x = Math.ceil(me.x)
        }
        // Aggiusto lo spostamento in y
        if (me.y > Math.floor(me.y) && me.y < (Math.floor(me.y) + 0.5)){
            me.y = Math.floor(me.y)
        } else if (me.y > Math.floor(me.y) && me.y > (Math.floor(me.y) + 0.5)) {
            me.y = Math.ceil(me.y)
        }
    }

}

/**
 * Esegueazione di spostamento tramite pddl.
 * 
 * @param {String} current_position format: "tile_x_y"
 * @param {String} target_position format: "tile_x_y"
 */
async function PddlMove(current_position, target_position){

    console.log(`current_position: ${current_position}, target_position: ${target_position}`);

    // Generate problem

    let objects = [];
    let init = [];
    let goal = [];

    for (const tile of map.tiles.values()){
        objects.push(tile.toPDDLString());
        for (const direction of tile.neighbors.keys()){
            init.push(`(${direction} ${tile.toPDDLString()} ${tile.neighbors.get(direction).toPDDLString()})`)
        }
    }

    for (const agent of otherAgents.values()){
        init.push(`(obstacle_position tile_${agent.x}_${agent.y})`);
    }

    init.push(`(at ${current_position})`);

    goal.push(`(at ${target_position})`);


    let pddlProblem = new PDDLProblem(objects, init, goal);

    // Salvo il problema su file (per debug)
    //await pddlProblem.toFile("./problem.pddl");

    try{
        const plan = await onlineSolver(pddlDomain.toPDDLString(), pddlProblem.toPDDLString());

        for (let i=0; i<plan.length; ++i){
            const actionToPerform = mapPddlActionToDeliverooAction.get(plan[i]["action"].toLocaleLowerCase());

            if (actionToPerform){
                await client.emitMove(actionToPerform);
                // Postpone next iteration at setImmediate
                await new Promise( res => setImmediate( res ) );

                // Aggiusto lo spostamento in x
                if (me.x > Math.floor(me.x) && me.x < (Math.floor(me.x) + 0.5)){
                    me.x = Math.floor(me.x)
                } else if (me.x > Math.floor(me.x) && me.x > (Math.floor(me.x) + 0.5)) {
                    me.x = Math.ceil(me.x)
                }
                // Aggiusto lo spostamento in y
                if (me.y > Math.floor(me.y) && me.y < (Math.floor(me.y) + 0.5)){
                    me.y = Math.floor(me.y)
                } else if (me.y > Math.floor(me.y) && me.y > (Math.floor(me.y) + 0.5)) {
                    me.y = Math.ceil(me.y)
                }
            } else {
                throw new Error( `Action ${actionToPerform} not defined!` );
            }
        }
    } catch {

    }

    //console.log(plan);
    //const pddlExecutor = new PddlExecutor( pddlDomain );
    //pddlExecutor.exec( plan );
}

client.onParcelsSensing( async ( parcels ) => {

    if (already_managing)
        return

    already_managing = true

    console.log( `me(${me.x},${me.y})`,
        parcels
        .map( p => `${p.reward}@(${p.x},${p.y})` )
        .join( ' ' )
    );

    let carring = false
    for ( const p of parcels ) {
        if ( ! p.carriedBy && p.reward > 0) {
            
            // Mi muovo verso il pacchetto
            //await SimpleMove(p)

            // TODO: Attenzione all'assegnazione
            let current_position = `tile_${me.x}_${me.y}`;
            let target_position = `tile_${p.x}_${p.y}`;

            await PddlMove(current_position, target_position);
            
            // Raccolgo il pacchetto
            if (me.x == p.x && me.y == p.y)
            {
                await client.emitPickup();
                if (p.carriedBy == me.id)
                    carring = true
            }


        } else if (p.carriedBy == me.id){
            carring = true
        }
    }

    if (carring){
        //console.log('carring')
        let target = null
        let tile_distance = Infinity
        for (const tile of delivery_tiles){
            //console.log(tile)
            try {
                if (distance(me, tile) < tile_distance){
                    tile_distance = distance(me, tile)
                    target = tile
                }
            } catch(err) {
                console.log(err)
            }   
        }

        if (target != null){
            
            // Aggiusto lo spostamento in x
            if (me.x > Math.floor(me.x) && me.x < (Math.floor(me.x) + 0.5)){
                me.x = Math.floor(me.x)
            } else if (me.x > Math.floor(me.x) && me.x > (Math.floor(me.x) + 0.5)) {
                me.x = Math.ceil(me.x)
            }
            // Aggiusto lo spostamento in y
            if (me.y > Math.floor(me.y) && me.y < (Math.floor(me.y) + 0.5)){
                me.y = Math.floor(me.y)
            } else if (me.y > Math.floor(me.y) && me.y > (Math.floor(me.y) + 0.5)) {
                me.y = Math.ceil(me.y)
            }

            //await SimpleMove(target)

            // TODO: Attenzione all'assegnazione
            let current_position = `tile_${me.x}_${me.y}`;
            let target_position = `tile_${target.x}_${target.y}`;
            await PddlMove(current_position, target_position);

            //console.log(`me.x == target.x && me.y == target.y: ${me.x == target.x && me.y == target.y}`)
            if (me.x == target.x && me.y == target.y)
                await client.emitPutdown();
        }

    }
    already_managing = false
} )

