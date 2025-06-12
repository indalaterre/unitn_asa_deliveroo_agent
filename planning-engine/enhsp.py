from flask import Flask, request, jsonify
import subprocess
import os
import re
import tempfile

app = Flask(__name__)
ENHSP_JAR_PATH = "/app/enhsp/enhsp-dist/enhsp.jar"

@app.route("/plan", methods=["POST"])
def plan():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    domain_content = data.get("domain")
    problem_content = data.get("problem")
    flags = data.get("flags", "-opt -h hmax -s astar")

    with tempfile.TemporaryDirectory() as temp_dir:
        domain_path = os.path.join(temp_dir, "domain.pddl")
        problem_path = os.path.join(temp_dir, "problem.pddl")

        with open(domain_path, "w", encoding="utf-8") as f:
            f.write(domain_content)
        with open(problem_path, "w", encoding="utf-8") as f:
            f.write(problem_content)

        cmd = [
                  "java", "-jar", ENHSP_JAR_PATH,
                  "-o", domain_path,
                  "-f", problem_path
              ] + flags.split()

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            if result.returncode == 0:
                # Parse the output to extract the plan
                parsed_plan = parse_enhsp_output(result.stdout)
                app.logger.info(f'{parsed_plan["steps"]}')
                return jsonify({
                    'status': 'ok',
                    'result': {
                        'plan': parsed_plan['steps'],
                        'metrics': parsed_plan['metrics'],
                        'output': result.stdout
                    }
                })
            else:
                return jsonify({
                    'status': 'error',
                    'error': result.stderr,
                    'output': result.stdout
                }), 500
        except subprocess.TimeoutExpired:
            output = "Planner timed out."

    return jsonify({"output": output})


def parse_enhsp_output(output):
    """Parse ENHSP output to extract the plan"""
    lines = output.splitlines()
    plan_started = False
    plan_actions = []

    metrics = {
        "plan_length": None,
        "metric": None,
        "planning_time_ms": None,
        "heuristic_time_ms": None,
        "search_time_ms": None,
        "expanded_nodes": None,
        "states_evaluated": None,
        "dead_ends": None,
        "duplicates": None,
    }

    for line in lines:
        line = line.strip()

        if line == "Found Plan:":
            plan_started = True
            continue

        if plan_started:
            if re.match(r"^\d+(\.\d+)?:\s+\(.*\)$", line):
                plan_actions.append(line)
            elif line.startswith("Plan-Length:"):
                plan_started = False  # end of plan steps

        # Parse optional metadata
        if line.startswith("Plan-Length:"):
            metrics["plan_length"] = int(line.split(":")[1].strip())
        elif line.startswith("Metric"):
            metrics["metric"] = float(line.split(":")[1].strip())
        elif line.startswith("Planning Time"):
            metrics["planning_time_ms"] = int(line.split(":")[1].strip())
        elif line.startswith("Heuristic Time"):
            metrics["heuristic_time_ms"] = int(line.split(":")[1].strip())
        elif line.startswith("Search Time"):
            metrics["search_time_ms"] = int(line.split(":")[1].strip())
        elif line.startswith("Expanded Nodes"):
            metrics["expanded_nodes"] = int(line.split(":")[1].strip())
        elif line.startswith("States Evaluated"):
            metrics["states_evaluated"] = int(line.split(":")[1].strip())
        elif line.startswith("Number of Dead-Ends"):
            metrics["dead_ends"] = int(line.split(":")[1].strip())
        elif line.startswith("Number of Duplicates"):
            metrics["duplicates"] = int(line.split(":")[1].strip())

    return {
        "steps": plan_actions,
        "metrics": metrics
    }

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=6789, debug=True)