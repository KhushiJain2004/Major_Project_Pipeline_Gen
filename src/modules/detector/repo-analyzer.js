import dotenv from "dotenv";
import fs from "fs";
import { Octokit } from "octokit";
import path from "path";

dotenv.config();
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/* ---------------------------------------------------------
    Utility helpers
--------------------------------------------------------- */

function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("❌ Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function countFileTypes(files) {
  const counts = {};
  for (const f of files) {
    const ext = f.includes(".") ? f.split(".").pop().toLowerCase() : "(none)";
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

function detectLanguages(langBytes) {
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const percent = {};
  for (const [lang, bytes] of Object.entries(langBytes)) {
    percent[lang] = ((bytes / total) * 100).toFixed(2);
  }
  const dominant = Object.entries(percent).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
  return { percent, dominant };
}

async function getFileContent(owner, repo, path) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function buildFileTree(files) {
  const tree = {};
  
  for (const filepath of files) {
    const parts = filepath.split('/');
    let current = tree;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      
      if (isFile) {
        if (!current._files) current._files = [];
        current._files.push(part);
      } else {
        if (!current[part]) current[part] = {};
        current = current[part];
      }
    }
  }
  
  return tree;
}

function findCommonRoot(paths) {
  if (!paths || paths.length === 0) return '.';
  if (paths.length === 1) return path.dirname(paths[0]);
  
  const split = paths.map(p => p.split('/'));
  const minLength = Math.min(...split.map(s => s.length));
  
  let commonParts = [];
  for (let i = 0; i < minLength; i++) {
    const part = split[0][i];
    if (split.every(s => s[i] === part)) {
      commonParts.push(part);
    } else {
      break;
    }
  }
  
  return commonParts.length > 0 ? commonParts.join('/') : '.';
}

/* ---------------------------------------------------------
    Semantic Mapping Functions
--------------------------------------------------------- */

function mapSourceFilesByLanguage(files) {
  const languageMap = {
    javascript: [],
    typescript: [],
    python: [],
    java: [],
    go: [],
    rust: [],
    ruby: [],
    php: [],
    csharp: [],
    cpp: [],
    html: [],
    css: [],
    scss: [],
    sql: []
  };
  
  const extensions = {
    javascript: ['.js', '.jsx', '.mjs', '.cjs'],
    typescript: ['.ts', '.tsx'],
    python: ['.py'],
    java: ['.java'],
    go: ['.go'],
    rust: ['.rs'],
    ruby: ['.rb'],
    php: ['.php'],
    csharp: ['.cs'],
    cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
    html: ['.html', '.htm'],
    css: ['.css'],
    scss: ['.scss', '.sass'],
    sql: ['.sql']
  };
  
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    
    for (const [lang, exts] of Object.entries(extensions)) {
      if (exts.includes(ext)) {
        languageMap[lang].push(file);
        break;
      }
    }
  }
  
  // Filter out empty arrays
  return Object.fromEntries(
    Object.entries(languageMap).filter(([_, files]) => files.length > 0)
  );
}

function detectManifestFiles(files) {
  const manifests = {
    'package.json': [],
    'requirements.txt': [],
    'Pipfile': [],
    'pyproject.toml': [],
    'pom.xml': [],
    'build.gradle': [],
    'build.gradle.kts': [],
    'go.mod': [],
    'Cargo.toml': [],
    'composer.json': [],
    'Gemfile': [],
    'setup.py': []
  };
  
  for (const file of files) {
    const basename = path.basename(file);
    if (manifests.hasOwnProperty(basename)) {
      manifests[basename].push(file);
    }
  }
  
  // Filter out empty arrays and return with paths
  return Object.fromEntries(
    Object.entries(manifests)
      .filter(([_, paths]) => paths.length > 0)
      .map(([name, paths]) => [name, paths.map(p => ({ path: p, dir: path.dirname(p) }))])
  );
}

function detectConfigFiles(files) {
  return {
    dockerfile: files.filter(f => /dockerfile/i.test(path.basename(f))),
    dockerCompose: files.filter(f => /docker-compose\.ya?ml/i.test(f)),
    kubernetes: files.filter(f => /\.ya?ml$/.test(f) && /k8s|kubernetes|deployment|service|ingress/.test(f)),
    ci: files.filter(f => f.startsWith('.github/workflows/') || /\.gitlab-ci\.yml|circleci\/config\.yml|jenkinsfile/i.test(f)),
    webServers: files.filter(f => /nginx\.conf|apache\.conf|httpd\.conf/.test(f)),
    env: files.filter(f => /\.env(\..*)?$/i.test(f)),
    eslint: files.filter(f => /\.eslintrc|eslint\.config/i.test(f)),
    prettier: files.filter(f => /\.prettierrc|prettier\.config/i.test(f)),
    babel: files.filter(f => /\.babelrc|babel\.config/i.test(f)),
    webpack: files.filter(f => /webpack\.config/i.test(f)),
    vite: files.filter(f => /vite\.config/i.test(f)),
    tsconfig: files.filter(f => /tsconfig.*\.json/i.test(f)),
    jest: files.filter(f => /jest\.config/i.test(f)),
    pytest: files.filter(f => /pytest\.ini|setup\.cfg|pyproject\.toml/.test(f))
  };
}

function analyzeDirectoryStructure(files, fileTree) {
  const commonDirs = {
    source: ['src', 'source', 'lib', 'app'],
    frontend: ['frontend', 'client', 'web', 'ui', 'public', 'www'],
    backend: ['backend', 'server', 'api', 'services'],
    tests: ['test', 'tests', '__tests__', 'spec', 'e2e'],
    docs: ['docs', 'documentation', 'wiki'],
    config: ['config', 'configuration', 'settings'],
    scripts: ['scripts', 'tools', 'bin'],
    assets: ['assets', 'static', 'resources', 'media'],
    components: ['components', 'widgets', 'modules'],
    database: ['db', 'database', 'migrations', 'schema']
  };
  
  const detected = {};
  
  for (const [category, keywords] of Object.entries(commonDirs)) {
    detected[category] = [];
    
    for (const keyword of keywords) {
      // Check for top-level directories
      if (fileTree[keyword]) {
        detected[category].push(keyword);
      }
      
      // Check for nested directories (e.g., apps/frontend, packages/backend)
      for (const file of files) {
        const parts = file.split('/');
        if (parts.includes(keyword) && !detected[category].includes(keyword)) {
          detected[category].push(keyword);
          break;
        }
      }
    }
  }
  
  return Object.fromEntries(
    Object.entries(detected).filter(([_, dirs]) => dirs.length > 0)
  );
}

function detectMonorepoStructure(manifestFiles) {
  const packageJsons = manifestFiles['package.json'] || [];
  const isMonorepo = packageJsons.length > 1;
  
  if (!isMonorepo) return { isMonorepo: false };
  
  // Group by parent directory
  const workspaces = {};
  
  for (const pkg of packageJsons) {
    const dir = pkg.dir === '.' ? 'root' : pkg.dir;
    const topLevel = dir.split('/')[0];
    
    if (!workspaces[topLevel]) {
      workspaces[topLevel] = [];
    }
    workspaces[topLevel].push(pkg.path);
  }
  
  // Common monorepo patterns
  const patterns = {
    lerna: false,
    nx: false,
    turborepo: false,
    yarn_workspaces: false,
    pnpm_workspaces: false,
    custom: false
  };
  
  return {
    isMonorepo: true,
    workspaceRoots: Object.keys(workspaces),
    workspaces,
    patterns
  };
}

function inferArchitecture(structure) {
  const { directoryStructure, monorepo, sourceFilesMap } = structure;
  
  const hasFrontend = directoryStructure.frontend?.length > 0;
  const hasBackend = directoryStructure.backend?.length > 0;
  const hasMultipleServices = monorepo.isMonorepo && monorepo.workspaceRoots.length > 2;
  
  const hasFrontendCode = 
    sourceFilesMap.javascript?.some(f => /react|vue|angular|svelte/.test(f)) ||
    sourceFilesMap.typescript?.some(f => /react|vue|angular|svelte/.test(f)) ||
    sourceFilesMap.html?.length > 0;
  
  const hasBackendCode = 
    sourceFilesMap.python?.length > 0 ||
    sourceFilesMap.java?.length > 0 ||
    sourceFilesMap.go?.length > 0 ||
    (sourceFilesMap.javascript?.some(f => /express|fastify|koa|nest/.test(f)));
  
  if (hasMultipleServices) return 'microservices';
  if (hasFrontend && hasBackend) return 'fullstack-monorepo';
  if (hasFrontendCode && hasBackendCode) return 'fullstack-collocated';
  if (hasFrontendCode && !hasBackendCode) return 'spa-frontend';
  if (hasBackendCode && !hasFrontendCode) return 'backend-api';
  if (monorepo.isMonorepo) return 'monorepo';
  
  return 'monolith';
}

async function analyzePackageJson(owner, repo, pkgPath) {
  const content = await getFileContent(owner, repo, pkgPath);
  if (!content) return null;
  
  try {
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    const frameworks = [];
    const libraries = [];
    const tools = [];
    
    // Frontend frameworks
    if (deps.react || deps['react-dom']) frameworks.push('react');
    if (deps.vue) frameworks.push('vue');
    if (deps.angular || deps['@angular/core']) frameworks.push('angular');
    if (deps.svelte) frameworks.push('svelte');
    if (deps.next) frameworks.push('next');
    if (deps.nuxt) frameworks.push('nuxt');
    if (deps.gatsby) frameworks.push('gatsby');
    
    // Backend frameworks
    if (deps.express) frameworks.push('express');
    if (deps.fastify) frameworks.push('fastify');
    if (deps.koa) frameworks.push('koa');
    if (deps['@nestjs/core']) frameworks.push('nestjs');
    if (deps.hapi || deps['@hapi/hapi']) frameworks.push('hapi');
    
    // Build tools
    if (deps.webpack) tools.push('webpack');
    if (deps.vite) tools.push('vite');
    if (deps.rollup) tools.push('rollup');
    if (deps.parcel) tools.push('parcel');
    if (deps.esbuild) tools.push('esbuild');
    
    // Testing
    if (deps.jest) tools.push('jest');
    if (deps.vitest) tools.push('vitest');
    if (deps.mocha) tools.push('mocha');
    if (deps.cypress) tools.push('cypress');
    if (deps.playwright) tools.push('playwright');
    
    // UI libraries
    if (deps['@mui/material']) libraries.push('material-ui');
    if (deps['antd']) libraries.push('ant-design');
    if (deps['bootstrap']) libraries.push('bootstrap');
    if (deps['tailwindcss']) libraries.push('tailwind');
    
    return {
      name: pkg.name,
      version: pkg.version,
      scripts: pkg.scripts || {},
      dependencies: deps,
      engines: pkg.engines || {},
      frameworks,
      libraries,
      tools,
      workspaces: pkg.workspaces,
      type: pkg.type, // module or commonjs
    };
  } catch (e) {
    console.error(`Failed to parse ${pkgPath}:`, e.message);
    return null;
  }
}

async function analyzePythonRequirements(owner, repo, reqPath) {
  const content = await getFileContent(owner, repo, reqPath);
  if (!content) return null;
  
  const frameworks = [];
  const packages = content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  
  if (/flask/i.test(content)) frameworks.push('flask');
  if (/django/i.test(content)) frameworks.push('django');
  if (/fastapi/i.test(content)) frameworks.push('fastapi');
  if (/pyramid/i.test(content)) frameworks.push('pyramid');
  if (/tornado/i.test(content)) frameworks.push('tornado');
  
  return {
    packages,
    frameworks,
    has_pytest: /pytest/i.test(content),
    has_numpy: /numpy/i.test(content),
    has_pandas: /pandas/i.test(content),
    has_tensorflow: /tensorflow/i.test(content),
    has_pytorch: /torch/i.test(content),
  };
}

async function analyzeJavaProject(owner, repo, manifestPath) {
  const content = await getFileContent(owner, repo, manifestPath);
  if (!content) return null;
  
  const isPom = manifestPath.endsWith('pom.xml');
  const frameworks = [];
  
  if (isPom) {
    if (/spring-boot/i.test(content)) frameworks.push('spring-boot');
    if (/quarkus/i.test(content)) frameworks.push('quarkus');
    if (/micronaut/i.test(content)) frameworks.push('micronaut');
    
    return {
      buildTool: 'maven',
      frameworks,
      hasSpringBoot: frameworks.includes('spring-boot'),
      javaVersion: extractJavaVersion(content)
    };
  } else {
    // Gradle
    if (/spring-boot/i.test(content)) frameworks.push('spring-boot');
    if (/quarkus/i.test(content)) frameworks.push('quarkus');
    if (/micronaut/i.test(content)) frameworks.push('micronaut');
    
    return {
      buildTool: 'gradle',
      frameworks,
      hasSpringBoot: frameworks.includes('spring-boot'),
      javaVersion: extractJavaVersion(content)
    };
  }
}

function extractJavaVersion(content) {
  if (!content) return null;
  
  const patterns = [
    /<maven\.compiler\.source>(.*?)<\/maven\.compiler\.source>/,
    /<maven\.compiler\.target>(.*?)<\/maven\.compiler\.target>/,
    /<java\.version>(.*?)<\/java\.version>/,
    /sourceCompatibility\s*=\s*["']?(\d+)[."']?/,
    /targetCompatibility\s*=\s*["']?(\d+)[."']?/,
    /JavaLanguageVersion\.of\((\d+)\)/,
    /java\s+(\d+)/,
    /FROM.*(?:temurin|openjdk):(\d+)/,
    /java-version:\s*["']?(\d+)["']?/,
  ];
  
  for (const regex of patterns) {
    const match = content.match(regex);
    if (match && match[1]) {
      const value = match[1].trim();
      const num = Number(value);
      if (num >= 6 && num <= 25) return num.toString();
    }
  }
  
  return null;
}

/* ---------------------------------------------------------
    Component Detection
--------------------------------------------------------- */

async function detectComponents(owner, repo, semanticMap) {
  const components = [];
  const { manifestFiles, sourceFilesMap, directoryStructure } = semanticMap;
  
  // Detect frontend components
  const frontendComponent = await detectFrontendComponent(owner, repo, semanticMap);
  if (frontendComponent) components.push(frontendComponent);
  
  // Detect backend components
  const backendComponents = await detectBackendComponents(owner, repo, semanticMap);
  components.push(...backendComponents);
  
  // Detect standalone services
  const serviceComponents = detectServiceComponents(semanticMap);
  components.push(...serviceComponents);
  
  return components;
}

async function detectFrontendComponent(owner, repo, semanticMap) {
  const { manifestFiles, sourceFilesMap, directoryStructure } = semanticMap;
  const packageJsons = manifestFiles['package.json'] || [];
  
  for (const pkg of packageJsons) {
    const analysis = await analyzePackageJson(owner, repo, pkg.path);
    if (!analysis) continue;
    
    const isFrontend = analysis.frameworks.some(f => 
      ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby'].includes(f)
    );
    
    if (isFrontend) {
      return {
        id: `frontend-${pkg.dir.replace(/\//g, '-') || 'root'}`,
        type: 'frontend',
        framework: analysis.frameworks.find(f => 
          ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt'].includes(f)
        ),
        path: pkg.dir || '.',
        language: sourceFilesMap.typescript?.some(f => f.startsWith(pkg.dir)) ? 'typescript' : 'javascript',
        buildTool: analysis.tools.find(t => ['vite', 'webpack', 'rollup'].includes(t)),
        packageManager: 'npm', // Can be detected from lock files
        confidence: 0.9,
        metadata: analysis
      };
    }
  }
  
  // Check for static HTML sites
  if (sourceFilesMap.html?.length > 0) {
    return {
      id: 'frontend-static',
      type: 'frontend',
      framework: 'static-html',
      path: findCommonRoot(sourceFilesMap.html),
      language: 'html',
      confidence: 0.7,
      metadata: {
        htmlFiles: sourceFilesMap.html.length,
        hasCSS: sourceFilesMap.css?.length > 0,
        hasJS: sourceFilesMap.javascript?.length > 0
      }
    };
  }
  
  return null;
}

async function detectBackendComponents(owner, repo, semanticMap) {
  const backends = [];
  const { manifestFiles, sourceFilesMap } = semanticMap;
  
  // Node.js backend
  const packageJsons = manifestFiles['package.json'] || [];
  for (const pkg of packageJsons) {
    const analysis = await analyzePackageJson(owner, repo, pkg.path);
    if (!analysis) continue;
    
    const isBackend = analysis.frameworks.some(f => 
      ['express', 'fastify', 'koa', 'nestjs', 'hapi'].includes(f)
    );
    
    if (isBackend) {
      backends.push({
        id: `backend-node-${pkg.dir.replace(/\//g, '-') || 'root'}`,
        type: 'backend',
        language: 'node',
        framework: analysis.frameworks.find(f => 
          ['express', 'fastify', 'koa', 'nestjs', 'hapi'].includes(f)
        ),
        path: pkg.dir || '.',
        confidence: 0.85,
        metadata: analysis
      });
    }
  }
  
  // Python backend
  const pythonReqs = manifestFiles['requirements.txt'] || [];
  for (const req of pythonReqs) {
    const analysis = await analyzePythonRequirements(owner, repo, req.path);
    if (analysis && analysis.frameworks.length > 0) {
      backends.push({
        id: `backend-python-${req.dir.replace(/\//g, '-') || 'root'}`,
        type: 'backend',
        language: 'python',
        framework: analysis.frameworks[0],
        path: req.dir || '.',
        confidence: 0.85,
        metadata: analysis
      });
    }
  }
  
  // Java backend
  const javaPoms = manifestFiles['pom.xml'] || [];
  const javaGradles = [...(manifestFiles['build.gradle'] || []), ...(manifestFiles['build.gradle.kts'] || [])];
  
  for (const pom of javaPoms) {
    const analysis = await analyzeJavaProject(owner, repo, pom.path);
    if (analysis && analysis.frameworks.length > 0) {
      backends.push({
        id: `backend-java-${pom.dir.replace(/\//g, '-') || 'root'}`,
        type: 'backend',
        language: 'java',
        framework: analysis.frameworks[0],
        buildTool: 'maven',
        path: pom.dir || '.',
        confidence: 0.85,
        metadata: analysis
      });
    }
  }
  
  for (const gradle of javaGradles) {
    const analysis = await analyzeJavaProject(owner, repo, gradle.path);
    if (analysis && analysis.frameworks.length > 0) {
      backends.push({
        id: `backend-java-${gradle.dir.replace(/\//g, '-') || 'root'}`,
        type: 'backend',
        language: 'java',
        framework: analysis.frameworks[0],
        buildTool: 'gradle',
        path: gradle.dir || '.',
        confidence: 0.85,
        metadata: analysis
      });
    }
  }
  
  return backends;
}

function detectServiceComponents(semanticMap) {
  const services = [];
  const { sourceFilesMap } = semanticMap;
  
  // Go services
  if (sourceFilesMap.go?.length > 0) {
    services.push({
      id: 'service-go',
      type: 'service',
      language: 'go',
      path: findCommonRoot(sourceFilesMap.go),
      confidence: 0.8
    });
  }
  
  // Rust services
  if (sourceFilesMap.rust?.length > 0) {
    services.push({
      id: 'service-rust',
      type: 'service',
      language: 'rust',
      path: findCommonRoot(sourceFilesMap.rust),
      confidence: 0.8
    });
  }
  
  return services;
}

/* ---------------------------------------------------------
    Main Analyzer with Semantic Map
--------------------------------------------------------- */

export async function analyzeRepo(repoUrl, outPath) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  console.log(`🔍 Analyzing ${owner}/${repo} ...`);

  /* ---------------------- Base Repo Info */
  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const { data: langBytes } = await octokit.rest.repos.listLanguages({ owner, repo });
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "true",
  });

  const files = tree.tree.map((t) => t.path);
  const fileTypes = countFileTypes(files);
  const totalFiles = files.length;

  /* ---------------------- Language Composition */
  const { percent: languagePercents, dominant: dominantLang } = detectLanguages(langBytes);

  /* ---------------------- Build Hierarchical File Tree */
  const fileTree = buildFileTree(files);
  
  /* ---------------------- Semantic Mapping */
  console.log("📊 Building semantic map...");
  
  const sourceFilesMap = mapSourceFilesByLanguage(files);
  const manifestFiles = detectManifestFiles(files);
  const configFiles = detectConfigFiles(files);
  const directoryStructure = analyzeDirectoryStructure(files, fileTree);
  const monorepo = detectMonorepoStructure(manifestFiles);
  
  const semanticMap = {
    fileTree,
    sourceFilesMap,
    manifestFiles,
    configFiles,
    directoryStructure,
    monorepo
  };
  
  const architecture = inferArchitecture(semanticMap);
  
  /* ---------------------- Component Detection */
  console.log("🔎 Detecting components...");
  const components = await detectComponents(owner, repo, semanticMap);
  
  /* ---------------------- Legacy Analysis (keeping for compatibility) */
  const binaryPattern = /\.(png|jpg|jpeg|gif|exe|bin|zip|pdf|class|o|wasm)$/i;
  const binaryCount = files.filter((f) => binaryPattern.test(f)).length;
  const binaryRatio = ((binaryCount / totalFiles) * 100).toFixed(2);

  const hasDocs = files.some((f) => /(^docs\/|readme|contributing)/i.test(f));
  const hasTests = files.some((f) => /(test|spec|__tests__)/i.test(f));

  const ciWorkflows = files.filter((f) => f.startsWith(".github/workflows/"));
  const ciTools = files.filter((f) =>
    /(gitlab-ci\.yml|circleci\/config\.yml|jenkinsfile)/i.test(f)
  );

  const workflowTriggers = [];
  for (const wf of ciWorkflows) {
    const cfg = await getFileContent(owner, repo, wf);
    if (!cfg) continue;
    if (/push:/i.test(cfg)) workflowTriggers.push("push");
    if (/pull_request:/i.test(cfg)) workflowTriggers.push("pull_request");
    if (/release:/i.test(cfg)) workflowTriggers.push("release");
  }

  const hasEnv = files.some((f) => /\.env(\.example)?$/i.test(f));
  const secretsMentioned = files.filter((f) => /(secret|token|key)/i.test(f));
  const hasVulnConfig = files.some((f) => /(dependabot|snyk|trivy)/i.test(f));

  /* ---------------------------------------------------------
    FINAL JSON with Semantic Map
  --------------------------------------------------------- */

  const result = {
    repo: `${owner}/${repo}`,
    
    // NEW: Semantic Map
    semanticMap: {
      fileTree: fileTree,
      sourceFilesMap,
      manifestFiles,
      configFiles,
      directoryStructure,
      monorepo,
      architecture,
      components
    },

    metadata: {
      description: repoInfo.description,
      topics: repoInfo.topics,
      stars: repoInfo.stargazers_count,
      forks: repoInfo.forks_count,
      watchers: repoInfo.subscribers_count,
      license: repoInfo.license ? repoInfo.license.spdx_id : "None",
      default_branch: repoInfo.default_branch,
      last_commit: repoInfo.pushed_at,
    },

    composition: {
      languages: languagePercents,
      dominant_language: dominantLang,
      total_files: totalFiles,
      file_types_count: fileTypes,
      binary_file_ratio: `${binaryRatio}%`,
      has_docs: hasDocs,
      has_tests: hasTests,
    },

    ci_cd: {
      has_workflows: ciWorkflows.length > 0,
      existing_ci_tools: ciTools,
      workflow_count: ciWorkflows.length,
      workflow_triggers: [...new Set(workflowTriggers)],
    },

    security: {
      has_env_file: hasEnv,
      secrets_mentions: secretsMentioned,
      vulnerability_configs: hasVulnConfig,
    },

    // Legacy compatibility
    detectedFiles: files.map((f) => f.toLowerCase()),
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`✅ Analysis complete → ${outPath}`);
  console.log(`📦 Detected ${components.length} components`);
  console.log(`🏗️  Architecture: ${architecture}`);
  
  return result;
}