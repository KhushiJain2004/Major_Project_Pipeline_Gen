/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */

import path from "path";
import { runGenerator } from "./src/app.js";
import fs from "fs";
export default (app) => {
  // Your code here
  app.log.info("Yay, the app was loaded!");

  app.on("issues.opened", async (context) => {
    app.log.info("new issue opened");
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    return context.octokit.issues.createComment(issueComment);
  });


  app.on(["installation.created", "installation_repositories.added","repository.created"], async (context) => {
    // app.log.info("hellooooo");
    const installationId = context.payload.installation.id;
    const repos = context.payload.repositories || context.payload.repositories_added;

    for (const repo of repos) {
      const repoFullName = repo.full_name;
      app.log.info(`🔧 Generating workflow for ${repoFullName}`);

      const octokit = await context.octokit;

      const repoUrl = `https://github.com/${repoFullName}.git`;

      // 1. Run your generator
      const outDir = path.resolve("./output");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const { workflowFile } = await runGenerator(repoUrl, outDir);

      const workflowContent = fs.readFileSync(workflowFile, "utf-8");

      const [owner, repoName] = repo.full_name.split("/");

      const { data: repoData } = await octokit.repos.get({
        owner,
        repo: repoName,
      });
      const baseBranch = repoData.default_branch; // usually "main"

      // 2. Get latest commit SHA of base branch
      const { data: baseRefData } = await octokit.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${baseBranch}`,
      });
      const latestCommitSha = baseRefData.object.sha;

      // 3. Create a new branch name
      const branchName = "pipeline-generator/ci-setup";

      let branchExists = true;
      try {
        await octokit.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${branchName}`,
        });
      } catch (e) {
        branchExists = false;
      }
      // 4. Create the new branch
      if (!branchExists) {
        await octokit.git.createRef({
          owner,
          repo: repoName,
          ref: `refs/heads/${branchName}`,
          sha: baseRefData.object.sha,
        });
      }
      

      // 5. Check if workflow already exists in branch
        let sha;
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo: repoName,
            path: ".github/workflows/ci.yml",
            ref: branchName,
          });
          sha = fileData.sha; // required for updates
          app.log.info("Workflow file already exists, will update it.");
        } catch (e) {
          sha = undefined; // file does not exist yet
        }

        // 6. Create or update the file
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo: repoName,
          path: ".github/workflows/ci.yml",
          message: "Add CI pipeline via GitHub App",
          content: Buffer.from(workflowContent).toString("base64"),
          branch: branchName,
          ...(sha ? { sha } : {}),
        });

         const { data: prs } = await octokit.pulls.list({
          owner,
          repo: repoName,
          head: `${owner}:${branchName}`,
          base: baseBranch,
        });
  if (prs.length== 0) {
      // 6. Create a Pull Request
      await octokit.pulls.create({
        owner,
        repo: repoName,
        head: branchName,
        base: baseBranch,
        title: "Add CI pipeline via GitHub App",
        body: "This PR adds an auto-generated CI workflow.",
      });

    }
      app.log.info(`🎉 Workflow installed into ${repoFullName}`);
    }
  });
};
