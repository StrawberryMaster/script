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

        // remove spaces at the end of the line caused by comment removal
        if (split[split.length - 1] == " ") {
            split = split.slice(0, split.length - 1);
        }

        removedComments.push(split);
    })

    parser.question = -1;
    parser.inQuestion = false;
    parser.answer = -1;
    parser.inAnswer = false;
    parser.declaredFeedback = false;

    parser.warnings = []

    parser.questions = []

    for (let i in removedComments) { // go line by line
        let line = removedComments[i];

        try {        
            if (line.slice(0, 8) == "Question") { // question
                parser.inQuestion = true;
                parser.question++;
                parser.answer = -1;
                parser.inAnswer = false;
                parser.declaredFeedback = false;

                let question = line.split(":"); // since the format is "Question ___: [question goes here]"
                question.splice(0,1)
                question = question.join(":")
                if (question[0] == " ") { // remove any space after the colon
                    question = question.slice(1, question.length);
                }

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
                if (answer[0] == " ") { // remove any spaces after the dash
                    answer = answer.slice(1, answer.length);
                }

                parser.questions[parser.question].answers.push({
                    answer: answer,
                    feedback: null // ignore if null, but importantly shouldn't ignore if just "()"
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
                if (feedback[0] == " ") {
                    feedback = feedback.slice(1, feedback.length);
                }
                if (feedback[feedback.length - 1] == " ") { 
                    feedback = feedback.slice(0, feedback.length - 1);
                }

                parser.questions[parser.question].answers[parser.answer].feedback = feedback;
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

    // init

    interpreted.questions = [];
    interpreted.answers = [];
    interpreted.feedback = [];

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

            if (!parser.questions[i].answers[_i].feedback) continue;

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
    }

    interpreted.code += `e.questions_json = ${JSON.stringify(interpreted.questions)};\n`
    interpreted.code += `e.answers_json = ${JSON.stringify(interpreted.answers)};\n`

    let feedback = JSON.stringify(interpreted.feedback)
    feedback = feedback.replaceAll(`"[REPLACE THIS VERY SPECIFIC STRING WITH e.candidate_id]"`, "e.candidate_id")

    interpreted.code += `e.answer_feedback_json = ${feedback};\n`

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
