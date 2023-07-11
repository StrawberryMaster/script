const cleanSpace = (string, end=false) => {
    string = end ? string.split('').reverse().join('') : string;
    for (let i in string) {
        if (string[i] != " ") {
            string = string.slice(Number(i), string.length);
            string = end ? string.split('').reverse().join('') : string;
            return string;
        }
    }
}

interpretCode = (working) => {

    parser = {}

    // parsing phase

    let newlineparse = working.split("\n");
    removedComments = [];
    newlineparse.forEach(f => {
        // remove comments
        let split = f.split("#")[0];
        if (split == "") {
            return;
        }

        // remove spaces at line start and at the end of the line caused by comment removal
        split = cleanSpace(split, true);
        split = cleanSpace(split)

        removedComments.push(split);
    })

    // check for config data

    parser.inConfig = false;
    parser.config = {}

    parser.warnings = []

    let final_lines = []

    parser.alias = []

    removedComments.forEach((f, i) => {
        try {
            if (i == 0 && f.toLowerCase() == "defaults") {
                parser.config["defaults"] = true;

                return;
            }

            if (f[0] == ";") { // config line
                f = f.substr(1,f.length)
                f = cleanSpace(f);
    
                if (f == null) {
                    parser.inConfig = false;
                    return;
                }
    
                if (f.slice(0, 6).toLowerCase() == "config") { // declared config
                    parser.inConfig = true;
                    return
                }
    
                // else end config
    
                parser.inConfig = false;
    
                return;
            }

            if (parser.inConfig) {
                if (f.slice(0, 5) == "alias") {
                    let line = f.substr(6, f.length);

                    line = line.split("=");
                    line = line.map(f => {
                        f = cleanSpace(f);
                        f = cleanSpace(f, true);
                        return f;
                    });

                    let config_statement = line.splice(0, 1);
                    let remainder = line.join("=");
                    
                    parser.alias.push([`%${config_statement}`, remainder]);

                    return;
                }
                let line = f.split("=");
                line = line.map(f => {
                    f = cleanSpace(f);
                    f = cleanSpace(f, true);
                    return f;
                }); // clean spaces around it
    
                let config_statement = line.splice(0, 1);
                let remainder = line.join("=");
    
                parser.config[config_statement] = remainder;
                return;
            }

            final_lines.push(f);
        } catch (e) {
            parser.warnings.push(`<code style='color:orange;'><b>Warning:</b> invalid config line on <b title="This excludes comments and blank lines.">interpreted line</b> ${Number(i) + 1}. The line was skipped.</code>`)
        }
    })

    let fL = final_lines.join("\n");
    parser.alias.forEach(f=>{
        fL = fL.replaceAll(f[0], f[1])
    });
    final_lines = fL.split("\n");

    parser.alias = [{
        alias: `"[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]"`,
        to: "e.candidate_id"
    }]

    parser.inConfig = false;

    parser.question = -1;
    parser.inQuestion = false;
    parser.answer = -1;
    parser.inAnswer = false;
    parser.declaredFeedback = false;

    parser.questions = []

    for (let i in final_lines) { // go line by line
        let line = final_lines[i];

        try {        
            if (line.slice(0, 8).toLowerCase() == "question") { // question
                parser.inQuestion = true;
                parser.question++;
                parser.answer = -1;
                parser.inAnswer = false;
                parser.declaredFeedback = false;

                let question = line.split(":"); // since the format is "Question ___: [question goes here]"
                question.splice(0,1)
                question = question.join(":")
                question = cleanSpace(question); // remove any space after the colon

                parser.questions.push({
                    question: question,
                    answers: []
                });

                continue;
            }

            if (line[0] == "-") { // answer
                if (!parser.inQuestion) { // make sure no answers are being declared outside of questions
                    throw "Answer declared outside of question block.";
                }
                if (parser.answer == 3) { // make sure max 4 answers per question
                    throw "More than 4 answers were given."
                }

                parser.inAnswer = true;
                parser.answer++;
                parser.declaredFeedback = false;

                let answer = line.split("-");
                answer.splice(0,1)
                answer = answer.join("-")
                answer = cleanSpace(answer); // remove any spaces after the dash

                parser.questions[parser.question].answers.push({
                    answer: answer,
                    feedback: null, // ignore if null, but importantly shouldn't ignore if just "()"
                    global_effect: [],
                    state_effect: [], 
                    issue_effect: [], 
                })
                
                continue;
            }

            if (line[0] == "(" && line[line.length - 1] == ")") { // feedback
                if (!parser.inAnswer) {
                    throw "Feedback declared outside of answer block."
                }
                if (parser.declaredFeedback) {
                    throw `Multiple answer feedbacks declared for answer ${parser.answer + 1}.`
                }

                parser.declaredFeedback = true;

                let feedback = line.slice(1, line.length - 1); // remove brackets

                // remove spaces so it can look like ( [feedback] )
                feedback = cleanSpace(feedback);
                feedback = cleanSpace(feedback, true);

                parser.questions[parser.question].answers[parser.answer].feedback = feedback;
                continue;
            }

            if (line.slice(0, 13).toLowerCase() == "affects issue" || line.slice(0, 2) == "+-") { // issue effect
                if (!parser.inAnswer) {
                    throw "Issue answer effect declared outside of answer block."
                }

                let question = cleanSpace(line)

                question = question.split(" "); // format is "Affects issue __ [by] __ [with] __"
                if (question.length <= 2) {
                    throw "Issue answer effect not specified."
                }

                if (line.slice(0, 2) == "+-") question.splice(0, 1); 
                else question.splice(0, 2); // remove "affects issue"

                let targetIssue = question[0];

                if (isNaN(Number(targetIssue))) { // target is a pk of format "pk_101"
                    if (targetIssue.replaceAll("pk_", "") == targetIssue) throw "Improperly formatted issue score PK.; should be pk_[pk number goes here]."
                    targetIssue = targetIssue.replaceAll("pk_", "")
                    targetIssue = Number(targetIssue)
                    question.splice(0, 1);
                } else { // target is a pk
                    parser.alias.push({
                        alias: `"[REPLACE THIS VERY SPECIFIC ISSUE NAME STRING WITH ${targetIssue}]"`,
                        to: `e.issues_json[${Number(targetIssue) - 1}].pk`
                    })
                    targetIssue = `[REPLACE THIS VERY SPECIFIC ISSUE NAME STRING WITH ${targetIssue}]`;

                    question.splice(0, 1);
                }

                if (isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0,1)
                }

                if (isNaN(Number(question[0]))) {
                    throw "Non-numerical issue effect specified."
                }

                let amount = Number(question[0]);
                
                question.splice(0,1)

                if (question.length != 1 && isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0,1)
                }

                if (question.length != 1) {
                    throw "Improper arguments for issue effect."
                }

                let importance = question[0];

                if (isNaN(Number(importance))) {
                    throw "Non-numerical issue importance specified."
                }

                importance = Number(importance);

                parser.questions[parser.question].answers[parser.answer].issue_effect.push([targetIssue, amount, importance]);

                continue;
            }

            if (line.slice(0, 13).toLowerCase() == "affects state" || line.slice(0, 2) == "+*") { // state effect
                if (!parser.inAnswer) {
                    throw "State answer effect declared outside of answer block."
                }

                let question = cleanSpace(line)

                question = question.split(" "); // format is "Affects state __ [by] __ [for] __"
                if (question.length <= 2) {
                    throw "State answer effect not specified."
                }

                if (line.slice(0, 2) == "+*") question.splice(0, 1); 
                else question.splice(0, 2); // remove "affects state"

                let targetState = question[0];

                if (isNaN(Number(targetState))) { // target is a name
                    targetState = targetState.replaceAll("_", " ");
                    parser.alias.push({
                        alias: `"[REPLACE THIS VERY SPECIFIC STATE NAME STRING WITH ${targetState}]"`,
                        to: `e.states_json[e.states_json.map(f=>f.fields.name).indexOf("${targetState}")].pk`
                    })
                    targetState = `[REPLACE THIS VERY SPECIFIC STATE NAME STRING WITH ${targetState}]`;
                    question.splice(0, 1);
                } else { // target is a pk
                    targetState = Number(targetState)
                    question.splice(0, 1);
                }

                if (isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0,1)
                }

                if (isNaN(Number(question[0]))) {
                    throw "Non-numerical state effect specified."
                }

                let amount = Number(question[0]);
                
                question.splice(0,1)

                if (question.length != 1 && isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0,1)
                }

                if (question.length != 1) {
                    throw "Improper arguments for state effect."
                }

                let target = question[0];

                if (isNaN(Number(target))) { // target is a name or self
                    if (target.toLowerCase() == "self") {
                        target = `[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]`;
                    } else {
                        target = target.replaceAll("_", " ");
                        parser.alias.push({
                            alias: `"[REPLACE THIS VERY SPECIFIC NAME STRING WITH ${target}]"`,
                            to: `[e.candidate_id, ...e.opponents_list][[e.candidate_id, ...e.opponents_list].map(f=>e.candidate_json[e.candidate_json.map(f=>f.pk).indexOf(f)].fields.last_name).indexOf("${target}")]`
                        })
                        target = `[REPLACE THIS VERY SPECIFIC NAME STRING WITH ${target}]`;
                    }
                    question.splice(0, 1);
                } else { // target is a pk
                    target = Number(target)
                    question.splice(0, 1);
                }

                parser.questions[parser.question].answers[parser.answer].state_effect.push([targetState, target, amount]);

                continue;
            }

            if (line.slice(0, 7).toLowerCase() == "affects" || line[0] == "+") { // global effect
                if (!parser.inAnswer) {
                    throw "Answer effect declared outside of answer block."
                }

                let question = cleanSpace(line)

                question = question.split(" "); // format is "Affects __ [by] __"
                if (question.length == 1) {
                    throw "Answer effect not specified."
                }

                question.splice(0, 1); // remove "Affects"

                let target = question[0];

                if (isNaN(Number(target))) { // target is a name or self
                    if (target.toLowerCase() == "self") {
                        target = `[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]`;
                    } else {
                        target = target.replaceAll("_", " ");
                        parser.alias.push({
                            alias: `"[REPLACE THIS VERY SPECIFIC NAME STRING WITH ${target}]"`,
                            to: `[e.candidate_id, ...e.opponents_list][[e.candidate_id, ...e.opponents_list].map(f=>e.candidate_json[e.candidate_json.map(f=>f.pk).indexOf(f)].fields.last_name).indexOf("${target}")]`
                        })
                        target = `[REPLACE THIS VERY SPECIFIC NAME STRING WITH ${target}]`;
                    }
                    question.splice(0, 1);
                } else { // target is a pk
                    target = Number(target)
                    question.splice(0, 1);
                }

                if (isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0,1)
                }

                if (question.length != 1) {
                    throw "Improper number of arguments for global effect."
                }

                if (isNaN(Number(question[0]))) {
                    throw "Non-numerical global effect specified."
                }

                let amount = Number(question[0]);

                parser.questions[parser.question].answers[parser.answer].global_effect.push([target, amount]);

                continue;
            }

            const cleanLine = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            parser.warnings.push(`<code style='color:orange;'><b>Warning</b> for Question ${parser.question + 1} on <b title="This excludes comments and blank lines.">interpreted line</b> ${Number(i) + 1}. The line was skipped.<br>Non-indicative statement made outside of comment.<br><br>Problematic line:<br><br>"<em>${cleanLine}</em>"</code>`)

        } catch (e) {
            const cleanLine = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const output = `<code style='color:red;'>Error encountered in Question ${parser.question + 1} on <b title="This excludes comments and blank lines.">interpreted line</b> ${Number(i) + 1}.<br>${e}<br><br>Problematic line:<br><br>"<em>${cleanLine}</em>"</code>`;
            return output;        
        }
    }

    // convert to code

    interpreted = {}

    interpreted.code = `// Generated with CampaignScript, report any issues (with CampaignScript) to Decstar.\n\ne = campaignTrail_temp;\n` // e=campaignTrail_temp is the only way to write code don't @ me

    strCopy = f => JSON.parse(JSON.stringify(f));

    // templates

    const question_template = {
        "model": "campaign_trail.question",
        "pk": 1000,
        "fields": {
            "priority": 1,
            "description": "Do you agree?",
            "likelihood": 1
        }
    }

    const answer_template = {
        "model": "campaign_trail.answer",
        "pk": 2000,
        "fields": {
            "question": 1000,
            "description": "I agree."
        }
    }

    const feedback_template = {
        "model": "campaign_trail.answer_feedback",
        "pk": 3000,
        "fields": {
            "answer": 2000,
            "candidate": 300,
            "answer_feedback": "You agree."
        }
    }

    const global_effect_template = {
        "model": "campaign_trail.answer_score_global",
        "pk": 4000,
        "fields": {
          "answer": 2000,
          "candidate": 300,
          "affected_candidate": 300,
          "global_multiplier": 0.1
        }
    }

    const state_effect_template = {
        "model": "campaign_trail.answer_score_state",
        "pk": 10000,
        "fields": {
          "answer": 2000,
          "state": 1100,
          "candidate": 300,
          "affected_candidate": 300,
          "state_multiplier": 0.1
        }
    }
    
    const issue_effect_template = {
        "model": "campaign_trail.answer_score_issue",
        "pk": 50000,
        "fields": {
          "answer": 2000,
          "issue": 110,
          "issue_score": 1,
          "issue_importance": 1
        }
    }

    // init

    interpreted.questions = [];
    interpreted.answers = [];
    interpreted.feedback = [];
    interpreted.globals = [];
    interpreted.stateEffs = [];
    interpreted.issueEffs = [];

    // make code

    for (let i in parser.questions) {
        // question

        let pk = 1000 + Number(i);
        let description = parser.questions[i].question;

        let question = strCopy(question_template);

        question.pk = pk;
        question.fields.description = description;

        interpreted.questions.push(question);

        for (let _i in parser.questions[i].answers) {
            // answer

            let answer_pk = 2000 + (Number(i) * 4) + Number(_i);
            let description = parser.questions[i].answers[_i].answer;

            let answer = strCopy(answer_template);

            answer.pk = answer_pk;
            answer.fields.question = pk;
            answer.fields.description = description;

            interpreted.answers.push(answer);

            if (parser.questions[i].answers[_i].feedback) {
                // feedback

                let feedback_pk = 3000 + (Number(i) * 4) + Number(_i);
                let ans_feedback = parser.questions[i].answers[_i].feedback;
                let candidate = "[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]";

                let feedback = strCopy(feedback_template);
                
                feedback.pk = feedback_pk;
                feedback.fields.answer = answer_pk;
                feedback.fields.candidate = candidate;
                feedback.fields.answer_feedback = ans_feedback;

                interpreted.feedback.push(feedback);
            }

            if (parser.questions[i].answers[_i].global_effect.length > 0) {
                // global effect
                // [target, amount]

                parser.questions[i].answers[_i].global_effect.forEach(f=> {
                    let global_pk = 4000 + (Number(i) * 20) + Number(_i);
                    let target = f[0];
                    let amount = f[1];

                    let global_eff = strCopy(global_effect_template);

                    global_eff.pk = global_pk;
                    global_eff.fields.answer = answer_pk;
                    global_eff.fields.candidate = "[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]";
                    global_eff.fields.affected_candidate = target;
                    global_eff.fields.global_multiplier = amount;

                    interpreted.globals.push(global_eff);
                })
            }

            if (parser.questions[i].answers[_i].state_effect.length > 0) {
                // state effect
                // [targetState, target, amount]

                parser.questions[i].answers[_i].state_effect.forEach(f=> {
                    let global_pk = 10000 + (Number(i) * 50) + Number(_i);
                    let targetState = f[0];
                    let target = f[1];
                    let amount = f[2];

                    let state_eff = strCopy(state_effect_template);

                    state_eff.pk = global_pk;
                    state_eff.fields.answer = answer_pk;
                    state_eff.fields.state = targetState;
                    state_eff.fields.candidate = "[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]";
                    state_eff.fields.affected_candidate = target;
                    state_eff.fields.state_multiplier = amount;

                    interpreted.stateEffs.push(state_eff);
                })
            }

            if (parser.questions[i].answers[_i].issue_effect.length > 0) {
                // issue effect
                // [targetIssue, amount, importance]

                parser.questions[i].answers[_i].issue_effect.forEach(f=> {
                    let issue_pk = 50000 + (Number(i) * 50) + Number(_i);
                    let targetIssue = f[0];
                    let amount = f[1];
                    let importance = f[2];

                    let issue_eff = strCopy(issue_effect_template);

                    issue_eff.pk = issue_pk;
                    issue_eff.fields.answer = answer_pk;
                    issue_eff.fields.issue = targetIssue;
                    issue_eff.fields.issue_score = amount;
                    issue_eff.fields.issue_importance = importance;

                    interpreted.issueEffs.push(issue_eff);
                })
            }
        }
    }

    if ((parser.config["defaults"] || parser.config["build_cand"] != null) && parser.config["!build_cand"] == null) {
        interpreted.code += `const findCandidate = (id) => e.candidate_json.find(f => f.pk === id);\ne.candidate_last_name = findCandidate(e.candidate_id).fields.last_name;\ne.candidate_image_url = findCandidate(e.candidate_id).fields.image_url;\ne.running_mate_last_name = findCandidate(e.running_mate_id).fields.last_name;\ne.running_mate_image_url = findCandidate(e.running_mate_id).fields.image_url;\n`
    }

    if ((parser.config["defaults"] || parser.config["suppress_cand_issues"] != null) && parser.config["!suppress_cand_issues"] == null) {
        interpreted.code += `e.candidate_issue_score_json = [];\n[e.candidate_id, ...e.opponents_list].forEach((_f,i) => {e.issues_json.forEach((f,_i)=>e.candidate_issue_score_json.push({"model":"campaign_trail.candidate_issue_score","pk":100000+(Number(i)*10)+_i,"fields":{"candidate":_f,"issue":f.pk,"issue_score":0}}))})\n`;
        interpreted.code += `e.running_mate_issue_score_json = [];\ne.issues_json.forEach((f,_i)=>e.running_mate_issue_score_json.push({"model":"campaign_trail.candidate_issue_score","pk":110000+_i,"fields":{"candidate":e.running_mate_id,"issue":f.pk,"issue_score":0}}))\n`;
    }

    interpreted.code += `e.questions_json = ${JSON.stringify(interpreted.questions)};\n`;
    interpreted.code += `e.answers_json = ${JSON.stringify(interpreted.answers)};\n`;
    interpreted.code += `e.answer_feedback_json = ${JSON.stringify(interpreted.feedback)};\n`;
    interpreted.code += `e.answer_score_global_json = ${JSON.stringify(interpreted.globals)};\n`;
    interpreted.code += `e.answer_score_state_json = ${JSON.stringify(interpreted.stateEffs)};\n`;
    interpreted.code += `e.answer_score_issue_json = ${JSON.stringify(interpreted.issueEffs)};\n`;

    // replace alias here:
    for (let i in parser.alias) {
        interpreted.code = interpreted.code.replaceAll(parser.alias[i].alias, parser.alias[i].to);
    }

    let output = `<code>${interpreted.code.replace(/</g, '&lt;').replace(/>/g, '&gt;').replaceAll("\n","<br>")}</code>`

    for (i in parser.warnings) {
        output += parser.warnings[i]
    }

    return output;
}

document.getElementById("submit_script").addEventListener("click", () => {
    let codeInp = document.getElementById("codeInput").value;
    let output = interpretCode(codeInp);
    document.getElementById("outputArea").innerHTML = output;
});

document.getElementById("copy_code").addEventListener("click", () => {
    let codeOut = document.getElementById("outputArea").children[0];
    let range = document.createRange();
    range.selectNodeContents(codeOut);
    let selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let toCopy = codeOut.innerText.replaceAll("<br>", "\n");
    navigator.clipboard.writeText(toCopy);
});
