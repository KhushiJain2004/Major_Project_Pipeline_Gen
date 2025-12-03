import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import {classify} from "./modules/classifier/run.js"
import path from "node:path";
import { render } from "./modules/renderer/render.js";

// const repoUrl = "https://github.com/KhushiJain2004/sample-node-repo.git";
// const repoUrl="https://github.com/KhushiJain2004/Devops_Lab.git";
// const repoUrl="https://github.com/dockersamples/helloworld-demo-node.git"

// const output = path.resolve('outputs/');
// const analyzerOutput=path.join(output,'feature.json');
// const classifierOutput=path.join(output,'values.json');
// const renderOutput=path.join(output,'ci.yml');
// const template_type='intermediate.hbs';

// await analyzeRepo(repoUrl,analyzerOutput).catch((err) => console.error("Error:", err.message));
// await classify(analyzerOutput,classifierOutput).catch((err) => console.error("Error:", err.message));
// await render(classifierOutput,renderOutput,template_type).catch((err) => console.error("Error:", err.message));


export async function runGenerator(repoUrl, outputDir) {
    console.log("inside generator");

//   const outDir = path.resolve("/output");
  const featureFile = path.join(outputDir,'feature.json');
  const workflowFile = path.join(outputDir,'ci.yml');
  const valuesFile = path.join(outputDir,'values.json');

  await analyzeRepo(repoUrl, featureFile).catch((err) => console.error("Error:", err.message));
  await classify(featureFile,valuesFile).catch((err) => console.error("Error:", err.message))
  await render(valuesFile, workflowFile, "intermediate.hbs").catch((err) => console.error("Error:", err.message));

  return { workflowFile };
}