const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }
                
        var payload = body;
        var testResults = payload.result; 
        var projectId = payload.projectId;
        var cycleId = payload.testcycle;
        var testLogs = [];
        var testSteps = [];
        var requiresDecode = payload.requiresDecode;

        if(requiresDecode == 'true') {
            var xmlString = decodeURI(testResults);
            xmlString = xmlString.replace(/`/g, '&');
        }

        console.log(xmlString);

        var parseString = require('xml2js').parseString;
        var startTime = '';
        var endTime = '';
        var lastEndTime = 0;

        parseString(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false
        }, function (err, result) {
            if (err) {
                emitEvent('ChatOpsEvent', { Error: "Unexpected Error Parsing XML Document: " + err }); 
                console.log(err);
            } else {
                var testsuites = Array.isArray(result.testsuites['testsuite']) ? result.testsuites['testsuite'] : [result.testsuites['testsuite']];
                testsuites.forEach(function(testsuite) {
                    lastEndTime = 0;
                    suiteName = testsuite.$.name;
                    console.log('Suite Name: ' + suiteName)
                    var testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase];
                    testcases.forEach(function(testcase) {
                        var classArray = [];
                        var className = testcase.$.name;
                        var moduleNames = [];
                        if(moduleNames.length == 0) {
                            moduleNames.push(suiteName);
                        }
                        console.log('Class Name: ' + className)
                        var classStatus = 'passed';
                        if(lastEndTime == 0) {
                            startTime = new Date(Date.parse(testsuite.$.timestamp)).toISOString();
                        } else {
                            startTime = lastEndTime;
                        }
                        interim = new Date(Date.parse(startTime)).getSeconds() + parseFloat(testcase.$.time);
                        endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                        endTime = new Date(endTime).toISOString();

                        stepArray = testcase.$.log.split('\r\n');
                        var stepOrder = 1;
                        testSteps = [];

                        stepArray.forEach(function(step) {
                            var testStep = '';
                            if(step.trim() == '') {
                                console.log('Blank line, skipping');
                            }
                            if(step.startsWith('+ Passed')) {
                                console.log('Step is a pass');
                                testStep = {
                                    description: step.replace('+ Passed', '').trim(),
                                    expected_result: step.replace('+ Passed', '').trim(),
                                    actual_result: step.replace('+ Passed', '').trim(),
                                    order: stepOrder,
                                    status: "PASSED"
                                };
                                testSteps.push(testStep);
                                stepOrder ++;
                            }
                            else if(step.startsWith('- Failed')) {
                                console.log('Step is a failure');
                                testStep = {
                                    description: step.replace('- Failed', '').trim(),
                                    expected_result: step.replace('- Failed', '').trim(),
                                    actual_result: step.replace('- Failed', '').trim(),
                                    order: stepOrder,
                                    status: "FAILED"
                                };
                                testSteps.push(testStep);
                                stepOrder ++;
                            }
                            else {
                                console.log('Step is part of last step, appending');
                                testSteps[testSteps.length - 1].description = testSteps[testSteps.length - 1].description.concat('\n', step.trim());
                                testSteps[testSteps.length - 1].expected_result = testSteps[testSteps.length - 1].expected_result.concat('\n', step.trim());
                                testSteps[testSteps.length - 1].actual_result = testSteps[testSteps.length - 1].actual_result.concat('\n', step.trim());
                            }
                        })

                        var note = '';
                        var stack = '';
                        var testFailure = Array.isArray(testcase.failure) ? testcase.failure : [testcase.failure];
                        testFailure.forEach(function(failure) {
                            if(failure !== undefined) {
                                note = failure.$.message;
                                stack = failure.$.message;
                                classStatus = 'failed';
                            }
                        });
                        console.log(classStatus);

                        var testLog = {
                            status: classStatus,
                            name: className,
                            attachments: [],
                            test_step_logs: testSteps,
                            note: note,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(className),
                            module_names: moduleNames
                        };
                        if (stack !== '') {
                        testLog.attachments.push({
                            name: `${className}.txt`,
                            data: Buffer.from(stack).toString("base64"),
                            content_type: "text/plain"
                        });
                        }
                        //testLog.attachments.push(payload.consoleOutput[0]);
                        testLogs.push(testLog);
                        lastEndTime = endTime;
                    }); // end
                });
            }
        });

        var formattedResults = {
            "projectId" : projectId,
            "testcycle": cycleId,
            "logs" : testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults );

};

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
