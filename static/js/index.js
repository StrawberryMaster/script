const cleanSpace = (string, end = false) => {
    if (end) return string.trimEnd();
    return string.trimStart();
};

const parseConfig = (lines) => {
    const config = {};
    const alias = [];
    const warnings = [];
    let inConfig = false;
    const final_lines = [];

    lines.forEach((f, i) => {
        try {
            if (i === 0 && f.toLowerCase() === "defaults") {
                config["defaults"] = true;
                return;
            }

            if (f.startsWith(";")) {
                const command = f.slice(1).trim();
                if (command.toLowerCase().startsWith("config")) {
                    inConfig = true;
                } else {
                    inConfig = false;
                }
                return;
            }

            if (inConfig) {
                if (f.startsWith("alias")) {
                    let [config_statement, ...rest] = f.slice(6).split("=").map(s => s.trim());
                    let remainder = rest.join("=");
                    alias.push([`%${config_statement}`, remainder]);
                } else {
                    let [config_statement, ...rest] = f.split("=").map(s => s.trim());
                    let remainder = rest.join("=");
                    config[config_statement] = remainder;
                }
            } else {
                final_lines.push(f);
            }
        } catch (e) {
            warnings.push(`<code style='color:orange;'><b>Warning:</b> invalid config line on <b title="This excludes comments and blank lines.">interpreted line</b> ${Number(i) + 1}. The line was skipped.</code>`);
        }
    });

    return { config, alias, warnings, final_lines };
};

const applyAliases = (lines, aliases) => {
    if (aliases.length === 0) {
        return lines;
    }
    let content = lines.join("\n");
    aliases.forEach(([alias, replacement]) => {
        content = content.replaceAll(alias, replacement);
    });
    return content.split("\n");
};

const parseScript = (lines, initialAlias) => {
    const parser = {
        warnings: [],
        alias: initialAlias,
        questions: [],
        question: -1,
        inQuestion: false,
        answer: -1,
        inAnswer: false,
        declaredFeedback: false,
    };

    for (const [i, line] of lines.entries()) {
        try {
            if (line.toLowerCase().startsWith("question")) {
                parser.inQuestion = true;
                parser.question++;
                parser.answer = -1;
                parser.inAnswer = false;
                parser.declaredFeedback = false;

                const questionText = line.split(":").slice(1).join(":").trim();
                parser.questions.push({
                    question: questionText,
                    answers: []
                });
            } else if (line.startsWith("-")) {
                if (!parser.inQuestion) throw "Answer declared outside of question block.";
                if (parser.questions[parser.question].answers.length >= 4) throw "More than 4 answers were given.";

                parser.inAnswer = true;
                parser.answer++;
                parser.declaredFeedback = false;

                const answerText = line.slice(1).trim();
                parser.questions[parser.question].answers.push({
                    answer: answerText,
                    feedback: [],
                    global_effect: [],
                    state_effect: [],
                    issue_effect: [],
                });
            } else if (line.startsWith("(") && line.endsWith(")")) {
                if (!parser.inAnswer) throw "Feedback declared outside of answer block.";

                const innerText = line.slice(1, -1).trim();
                const feedbackRegex = /for candidate (\d+):(.*)/i;
                const match = innerText.match(feedbackRegex);

                if (match) {
                    const candidateId = match[1].trim();
                    const feedbackText = match[2].trim();
                    parser.questions[parser.question].answers[parser.answer].feedback.push({ candidate: candidateId, text: feedbackText });
                } else {
                    // handle general feedback for backwards compatibility
                    if (parser.questions[parser.question].answers[parser.answer].feedback.some(f => f.candidate === null)) {
                        throw `Multiple answer feedbacks declared for answer ${parser.answer + 1}.`;
                    }
                    parser.questions[parser.question].answers[parser.answer].feedback.push({ candidate: null, text: innerText });
                }
            } else if (line.toLowerCase().startsWith("affects issue") || line.startsWith("+-")) { // issue effect
                if (!parser.inAnswer) {
                    throw "Issue answer effect declared outside of answer block."
                }

                let question = cleanSpace(line)

                question = question.split(" "); // format is "Affects issue __ [by] __ [with] __"
                if (question.length <= 2) {
                    throw "Issue answer effect not specified."
                }

                if (line.startsWith("+-")) question.splice(0, 1);
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
                    question.splice(0, 1)
                }

                if (isNaN(Number(question[0]))) {
                    throw "Non-numerical issue effect specified."
                }

                let amount = Number(question[0]);

                question.splice(0, 1)

                if (question.length != 1 && isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0, 1)
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
            } else if (line.toLowerCase().startsWith("affects state") || line.startsWith("+*")) { // state effect
                if (!parser.inAnswer) {
                    throw "State answer effect declared outside of answer block."
                }

                let question = cleanSpace(line)

                question = question.split(" "); // format is "Affects state __ [by] __ [for] __"
                if (question.length <= 2) {
                    throw "State answer effect not specified."
                }

                if (line.startsWith("+*")) question.splice(0, 1);
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
                    question.splice(0, 1)
                }

                if (isNaN(Number(question[0]))) {
                    throw "Non-numerical state effect specified."
                }

                let amount = Number(question[0]);

                question.splice(0, 1)

                if (question.length != 1 && isNaN(Number(question[0]))) { // remove any connectives in the next word
                    question.splice(0, 1)
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
            } else if (line.toLowerCase().startsWith("affects") || line.startsWith("+")) { // global effect
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
                    question.splice(0, 1)
                }

                if (question.length != 1) {
                    throw "Improper number of arguments for global effect."
                }

                if (isNaN(Number(question[0]))) {
                    throw "Non-numerical global effect specified."
                }

                let amount = Number(question[0]);

                parser.questions[parser.question].answers[parser.answer].global_effect.push([target, amount]);
            } else {
                const cleanLine = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                parser.warnings.push(`<code style='color:orange;'><b>Warning</b> for Question ${parser.question + 1} on <b title="This excludes comments and blank lines.">interpreted line</b> ${Number(i) + 1}. The line was skipped.<br>Non-indicative statement made outside of comment.<br><br>Problematic line:<br><br>"<em>${cleanLine}</em>"</code>`);
            }
        } catch (e) {
            const cleanLine = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const output = `<code style='color:red;'>Error encountered in Question ${parser.question + 1} on <b title="This excludes comments and blank lines.">interpreted line</b> ${Number(i) + 1}.<br>${e}<br><br>Problematic line:<br><br>"<em>${cleanLine}</em>"</code>`;
            return { error: output };
        }
    }
    return parser;
};

const generateCode = (parser) => {
    const interpreted = {
        questions: [],
        answers: [],
        feedback: [],
        globals: [],
        stateEffs: [],
        issueEffs: [],
        code: ''
    };

    const strCopy = f => JSON.parse(JSON.stringify(f));

    const question_template = { "model": "campaign_trail.question", "pk": 1000, "fields": { "priority": 1, "description": "Do you agree?", "likelihood": 1 } };
    const answer_template = { "model": "campaign_trail.answer", "pk": 2000, "fields": { "question": 1000, "description": "I agree." } };
    const feedback_template = { "model": "campaign_trail.answer_feedback", "pk": 3000, "fields": { "answer": 2000, "candidate": 300, "answer_feedback": "You agree." } };
    const global_effect_template = { "model": "campaign_trail.answer_score_global", "pk": 4000, "fields": { "answer": 2000, "candidate": 300, "affected_candidate": 300, "global_multiplier": 0.1 } };
    const state_effect_template = { "model": "campaign_trail.answer_score_state", "pk": 10000, "fields": { "answer": 2000, "state": 1100, "candidate": 300, "affected_candidate": 300, "state_multiplier": 0.1 } };
    const issue_effect_template = { "model": "campaign_trail.answer_score_issue", "pk": 50000, "fields": { "answer": 2000, "issue": 110, "issue_score": 1, "issue_importance": 1 } };

    parser.questions.forEach((q, i) => {
        const question_pk = 1000 + i;
        const question = strCopy(question_template);
        question.pk = question_pk;
        question.fields.description = q.question;
        interpreted.questions.push(question);

        q.answers.forEach((a, _i) => {
            const answer_pk = 2000 + (i * 4) + _i;
            const answer = strCopy(answer_template);
            answer.pk = answer_pk;
            answer.fields.question = question_pk;
            answer.fields.description = a.answer;
            interpreted.answers.push(answer);

            if (a.feedback && a.feedback.length > 0) {
                a.feedback.forEach((fb, fb_i) => {
                    const feedback = strCopy(feedback_template);
                    feedback.pk = 3000 + (i * 16) + (_i * 4) + fb_i;
                    feedback.fields.answer = answer_pk;
                    feedback.fields.candidate = fb.candidate ? Number(fb.candidate) : "[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]";
                    feedback.fields.answer_feedback = fb.text;
                    interpreted.feedback.push(feedback);
                });
            }

            a.global_effect.forEach((f, f_i) => {
                const global_eff = strCopy(global_effect_template);
                global_eff.pk = 4000 + (i * 20) + _i + f_i;
                global_eff.fields.answer = answer_pk;
                global_eff.fields.candidate = "[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]";
                global_eff.fields.affected_candidate = f[0];
                global_eff.fields.global_multiplier = f[1];
                interpreted.globals.push(global_eff);
            });

            a.state_effect.forEach((f, f_i) => {
                const state_eff = strCopy(state_effect_template);
                state_eff.pk = 10000 + (i * 50) + _i + f_i;
                state_eff.fields.answer = answer_pk;
                state_eff.fields.state = f[0];
                state_eff.fields.candidate = "[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]";
                state_eff.fields.affected_candidate = f[1];
                state_eff.fields.state_multiplier = f[2];
                interpreted.stateEffs.push(state_eff);
            });

            a.issue_effect.forEach((f, f_i) => {
                const issue_eff = strCopy(issue_effect_template);
                issue_eff.pk = 50000 + (i * 50) + _i + f_i;
                issue_eff.fields.answer = answer_pk;
                issue_eff.fields.issue = f[0];
                issue_eff.fields.issue_score = f[1];
                issue_eff.fields.issue_importance = f[2];
                interpreted.issueEffs.push(issue_eff);
            });
        });
    });

    const code = [];

    if (parser.config["hide_comment"] == null) {
        code.push(`// Generated with CampaignScript, report any issues (with CampaignScript) to Decstar.\n`);
    }
    if (parser.config["hide_init"] == null) {
        code.push(`e = campaignTrail_temp;`);
    }
    if ((parser.config["defaults"] || parser.config["build_cand"] != null) && parser.config["!build_cand"] == null) {
        code.push(`const findCandidate = (id) => e.candidate_json.find(f => f.pk === id);`);
        code.push(`e.candidate_last_name = findCandidate(e.candidate_id).fields.last_name;`);
        code.push(`e.candidate_image_url = findCandidate(e.candidate_id).fields.image_url;`);
        code.push(`e.running_mate_last_name = findCandidate(e.running_mate_id).fields.last_name;`);
        code.push(`e.running_mate_image_url = findCandidate(e.running_mate_id).fields.image_url;`);
    }
    if ((parser.config["defaults"] || parser.config["suppress_cand_issues"] != null) && parser.config["!suppress_cand_issues"] == null) {
        code.push(`e.candidate_issue_score_json = [];`);
        code.push(`[e.candidate_id, ...e.opponents_list].forEach((_f,i) => {e.issues_json.forEach((f,_i)=>e.candidate_issue_score_json.push({"model":"campaign_trail.candidate_issue_score","pk":100000+(Number(i)*10)+_i,"fields":{"candidate":_f,"issue":f.pk,"issue_score":0}}))})`);
        code.push(`e.running_mate_issue_score_json = [];`);
        code.push(`e.issues_json.forEach((f,_i)=>e.running_mate_issue_score_json.push({"model":"campaign_trail.candidate_issue_score","pk":110000+_i,"fields":{"candidate":e.running_mate_id,"issue":f.pk,"issue_score":0}}))`);
    }

    const stringify = (obj) => JSON.stringify(obj, null, 2);

    if (parser.config["hide_questions"] == null)
        code.push(`e.questions_json = ${stringify(interpreted.questions)};`);
    if (parser.config["hide_answers"] == null)
        code.push(`e.answers_json = ${stringify(interpreted.answers)};`);
    if (parser.config["hide_feedback"] == null)
        code.push(`e.answer_feedback_json = ${stringify(interpreted.feedback)};`);
    if (parser.config["hide_global_eff"] == null)
        code.push(`e.answer_score_global_json = ${stringify(interpreted.globals)};`);
    if (parser.config["hide_state_eff"] == null)
        code.push(`e.answer_score_state_json = ${stringify(interpreted.stateEffs)};`);
    if (parser.config["hide_issue_eff"] == null)
        code.push(`e.answer_score_issue_json = ${stringify(interpreted.issueEffs)};`);

    interpreted.code = code.join('\n');

    if (parser.alias.length > 0) {
        const aliasMap = Object.fromEntries(parser.alias.map(a => [a.alias, a.to]));
        const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(Object.keys(aliasMap).map(escapeRegex).join('|'), 'g');
        interpreted.code = interpreted.code.replace(regex, (matched) => aliasMap[matched]);
    }

    return interpreted;
};

const interpretCode = (working) => {
    const initialLines = working.split('\n').map(line => line.split("#")[0].trim()).filter(Boolean);

    const { config, alias, warnings, final_lines } = parseConfig(initialLines);

    const aliasedLines = applyAliases(final_lines, alias);

    const initialAlias = [{
        alias: `"[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]"`,
        to: "e.candidate_id"
    }];

    const parserResult = parseScript(aliasedLines, initialAlias);

    if (parserResult.error) {
        return parserResult.error;
    }

    const allWarnings = [...warnings, ...parserResult.warnings];

    const interpreted = generateCode({ ...parserResult, config });

    let output = `<code>${interpreted.code.replace(/</g, '&lt;').replace(/>/g, '&gt;').replaceAll("\n", "<br>")}</code>`;

    for (const warning of allWarnings) {
        output += warning;
    }

    return output;
};

const decompileCode = (working) => {
    try {
        // this is a bit of a hack, but it works for the format.
        const campaignTrail_temp = {};
        eval(working.replace(/campaignTrail_temp/g, "campaignTrail_temp"));

        const questions = campaignTrail_temp.questions_json || [];
        const answers = campaignTrail_temp.answers_json || [];
        const feedbacks = campaignTrail_temp.answer_feedback_json || [];
        const global_effects = campaignTrail_temp.answer_score_global_json || [];
        const state_effects = campaignTrail_temp.answer_score_state_json || [];
        const issue_effects = campaignTrail_temp.answer_score_issue_json || [];

        let output = "";

        for (const question of questions) {
            output += `Question ${question.pk}: ${question.fields.description}\n`;

            const questionAnswers = answers.filter(a => a.fields.question === question.pk).sort((a, b) => a.pk - b.pk);

            for (const answer of questionAnswers) {
                output += `- ${answer.fields.description}\n`;

                const answerFeedbacks = feedbacks.filter(f => f.fields.answer === answer.pk);
                for (const feedback of answerFeedbacks) {
                    output += `(for candidate ${feedback.fields.candidate}: ${feedback.fields.answer_feedback})\n`;
                }

                const answerGlobalEffects = global_effects.filter(e => e.fields.answer === answer.pk);
                for (const effect of answerGlobalEffects) {
                    output += `+ ${effect.fields.affected_candidate} ${effect.fields.global_multiplier}\n`;
                }

                const answerStateEffects = state_effects.filter(e => e.fields.answer === answer.pk);
                for (const effect of answerStateEffects) {
                    output += `+* ${effect.fields.state} ${effect.fields.affected_candidate} ${effect.fields.state_multiplier}\n`;
                }

                const answerIssueEffects = issue_effects.filter(e => e.fields.answer === answer.pk);
                for (const effect of answerIssueEffects) {
                    output += `+- ${effect.fields.issue} ${effect.fields.issue_score} ${effect.fields.issue_importance}\n`;
                }
                output += '\n';
            }
            output += '\n';
        }

        return `<code>${output.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</code>`;

    } catch (e) {
        console.error(e);
        return `<code style='color:red;'>Error during decompilation: ${e.message}</code>`;
    }
};

document.getElementById("submit_script").addEventListener("click", () => {
    const codeInp = document.getElementById("codeInput").value;
    const output = interpretCode(codeInp);
    document.getElementById("outputArea").innerHTML = output;
});

document.getElementById("copy_code").addEventListener("click", () => {
    const codeOut = document.getElementById("outputArea").children[0];
    if (!codeOut) return;
    const toCopy = codeOut.innerText;
    navigator.clipboard.writeText(toCopy);
});

document.getElementById("decompile_script").addEventListener("click", () => {
    const codeInp = document.getElementById("decompileInput").value;
    const output = decompileCode(codeInp);
    document.getElementById("decompileOutputArea").innerHTML = output;
});

document.getElementById("copy_decompile").addEventListener("click", () => {
    const codeOut = document.getElementById("decompileOutputArea").children[0];
    if (!codeOut) return;
    const toCopy = codeOut.innerText;
    navigator.clipboard.writeText(toCopy);
});
