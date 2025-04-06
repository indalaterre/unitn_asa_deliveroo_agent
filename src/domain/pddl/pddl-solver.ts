import { Position } from "@domain/models/environment"
import { PddlConfiguration } from "@domain/models/configurations"
import { PddlDomain } from "./pddl-domain"
import { PddlProblem } from "./pddl-problem";
import { BeliefContainer } from "@domain/beliefs";
import { PddlPlan, PddlAction } from "./pddl-utilities"

export class PddlSolver {

    public readonly host: string;

    public readonly pass_path: string;

    private readonly url: string;

    private readonly _beliefContainer: BeliefContainer;

    private readonly _pddlProblem: PddlDomain;

    public constructor(pddlConfiguration: PddlConfiguration, beliefContainer: BeliefContainer){
        this.host = pddlConfiguration.host;
        this.pass_path = pddlConfiguration.pass_path;

        let tmp_url = pddlConfiguration.host;
        if (!this.pass_path.startsWith("/")){
            tmp_url += "/";
        }
        tmp_url += this.pass_path;
        this.url = tmp_url;

        this._beliefContainer = beliefContainer;

        this._pddlProblem = new PddlDomain("src/domain/pddl/domain.pddl")
    }

    /**
     * 
     * @param agentPosition {Position} 
     * @param targetPosition {Position} 
     */
    public async getPlan(agentPosition: Position, targetPosition: Position): Promise<PddlPlan>{

        console.log(`Request plan from ${agentPosition} to ${targetPosition}`)

        const pddlMap = this._beliefContainer.map.getPddlMap();
        //const otherAgents = this._belifContaner.getOtherAgents();
        
        let objects = pddlMap.get("objects");
        let init = pddlMap.get("init");
        // init.push(otherAgents.join(" "));  // TODO: add other agent position (obstacle_position tile_x_y)
        init.push(`(at tile_${agentPosition.toPddlString()})`);
        let goal = [`(at tile_${targetPosition.toPddlString()})`];

        const pddlProblem = new PddlProblem(objects, init, goal);

        //console.log(pddlProblem.toPDDLString());
        //await pddlProblem.toFile("C:/Users/cresm/Git/unitn_asa_deliveroo_agent/src/domain/pddl/problem.pddl")

        const responseCheckUrl = await this.postRequest(this._pddlProblem.pddl_domain, pddlProblem.toPDDLString());

        let json = await this.getResult(responseCheckUrl);

        let plan = this.parsePlan(json);
        
        return plan;
    }
    
    private async postRequest(pddlDomain: string, pddlProblem: string) {
        
        var res = await fetch(this.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({domain: pddlDomain, problem: pddlProblem, number_of_plans: "1"})
        })
        
        if (res.status != 200){
            throw new Error(`Error at ${this.url} ${await res.text()}`);
        }
    
        var json = await res.json();
        
        // console.log(res);
    
        if (!json.result){
            console.log(res);
            throw new Error(`No value "result" from ${this.url} ${res}`);
        }
    
        return this.host + json.result;
    }
    
    
    private async getResult(responseCheckUrl){
    
        let json;

        while (true){
            //console.log("PENDING planning result from", responseCheckUrl);
    
            let res = await fetch(responseCheckUrl, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json"
                },
            });
    
            if (res.status != 200) {
                throw new Error(`Received HTTP error from ${this.host + res.status} ` + await res.text());
            }
        
            json = await res.json();
    
            if (json.status == "PENDING") {
                await new Promise((res, rej) => setTimeout(res, 100));
            }
            else
                break;
        }
    
        // console.log(json);
        // console.log(json.plans[0].result);
        // console.log(json.plans[0].result.plan);
    
        if (json.status != "ok"){
            //console.log(json);
            throw new Error(`Invalid 'status' in response body from ${responseCheckUrl}`);
        }
        
        if (!json.result){
            console.log(json);
            throw new Error(`No 'result' in response body from ${responseCheckUrl}`);
        }
        
        if (! ('stdout' in json.result)){
            console.log(json);
            throw new Error(`No 'result.stdout' in response from ${responseCheckUrl}`);
        }
    
        return json;
    }
    
    
    private async parsePlan(json): Promise<PddlPlan> {
    
        let lines = [];
        if (json.result.output.plan)
            lines = json.result.output.plan.split("\n");
    
        // PARSING plan from /package/dual-bfws-ffparser/solve
        if (json.result.stdout.split("\n").includes(" --- OK.")){
    
            //console.log("Using parser for /package/dual-bfws-ffparser/solve");
    
            lines = lines.map(line => line.replace("(", "").replace(")", "").split(" "));
            lines = lines.slice(0,-1);
        }
    
        // PARSING plan from /package/delfi/solve
        else if (json.result.call.split(" ").includes("delfi") && json.result.stdout.split("\n").includes("Solution found.")){
            
            console.log("Using parser for /package/delfi/solve");
    
            lines = lines.map(line => line.replace("(", "").replace(")", "").split(" "));
            lines = lines.slice(0,-1);
        }
    
        // PARSING plan from /package/enhsp-2020/solve
        else if (lines.includes("Problem Solved")){
    
            //console.log("Using parser for /package/enhsp-2020/solve");
    
            let startIndex = lines.indexOf("Problem Solved") + 1;
            let endIndex = lines.findIndex((line) => line.includes("Plan-Length"));
            lines = lines.slice(startIndex, endIndex);
            
            lines = lines.map(line => line.replace("(", "").replace(")", "").split(" ").slice(1));
        }
    
        // PARSING plan from /package/optic/solve
        else if (json.result.call.split(" ").includes("optic") && lines.includes(";;;; Solution Found")){
            
            //console.log("Using parser for /package/optic/solve");
            
            let startIndex = lines.indexOf(";;;; Solution Found") + 1;
            lines = lines.slice(startIndex + 3);
    
            lines = lines.map(line => line.replace("(", "").replace(")", "").split(" ").slice(1, -1));
            lines = lines.slice(0,-1);
        }
    
        // ERROR
        else {
            console.log(json);
            console.error("Plan not found!")
            return;
        }
    
        let plan = new PddlPlan();
    
        console.log("Plan found")
    
        for (let line of lines){
    
            //console.log("- " + line);
    
            let action = line[0].toLowerCase();
            let from_splits = line[1].split("_");  // tile_x_y
            let from = new Position(Number.parseInt(from_splits[1]), Number.parseInt(from_splits[2]));
            let to_splits = line[2].split("_");  // tile_x_y
            let to = new Position(Number.parseInt(to_splits[1]), Number.parseInt(to_splits[2]));
            
            
            plan.pushAction(new PddlAction(action, from, to));
        }
        
        return plan;
    }
}

