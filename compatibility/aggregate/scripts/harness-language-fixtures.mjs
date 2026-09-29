import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

export function createLanguageFixture(language, root) {
  mkdirSync(root, { recursive: true });
  const write = (name, text) => {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  if (language === "cpp") {
    write(
      "value.hpp",
      "#pragma once\nstruct Value { virtual int get() const = 0; };\nstruct Answer : Value { int get() const override { return 42; } };\ninline int answer() { return 42; }\n",
    );
    const bad =
      '#include "value.hpp"\nint main() { int result = "wrong"; return answer() == 42 ? result : 1; }\n';
    const file = write("main.cpp", bad);
    write(
      "compile_commands.json",
      JSON.stringify([
        {
          directory: root,
          file,
          arguments: ["g++", "-std=c++17", "-I" + root, "-c", file],
        },
      ]),
    );
    return {
      file,
      bad,
      good: bad.replace('"wrong"', "0"),
      definition: [2, bad.split("\n")[1].indexOf("answer()") + 1],
      symbol: "answer",
      library: "value.hpp",
      implementation: { file: join(root, "value.hpp"), line: 2, column: 28 },
      check: ["g++", ["-std=c++17", "-fsyntax-only", "main.cpp"]],
    };
  }
  if (language === "rust") {
    write(
      "Cargo.toml",
      '[package]\nname = "coffee-fixture"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    write(
      "src/value.rs",
      "pub trait Value { fn get(&self) -> i32; }\npub struct Answer;\nimpl Value for Answer { fn get(&self) -> i32 { 42 } }\npub fn answer() -> i32 { Answer.get() }\n",
    );
    const bad =
      'mod value;\nfn main() { let result: i32 = "wrong"; println!("{}", value::answer() + result); }\n';
    const file = write("src/main.rs", bad);
    return {
      file,
      bad,
      good: bad.replace('"wrong"', "0"),
      definition: [2, bad.split("\n")[1].indexOf("answer()") + 1],
      symbol: "answer",
      library: "value.rs",
      implementation: { file: join(root, "src/value.rs"), line: 1, column: 11 },
      check: ["cargo", ["check", "--offline"]],
    };
  }
  if (language === "go") {
    write("go.mod", "module fixture.local/coffee\n\ngo 1.24\n");
    write(
      "value.go",
      "package main\ntype Value interface { Get() int }\ntype Answer struct {}\nfunc (Answer) Get() int { return 42 }\nfunc answer() int { return Answer{}.Get() }\n",
    );
    const bad =
      'package main\nfunc main() { var result int = "wrong"; println(answer() + result) }\n';
    const file = write("main.go", bad);
    return {
      file,
      bad,
      good: bad.replace('"wrong"', "0"),
      definition: [2, bad.split("\n")[1].indexOf("answer()") + 1],
      symbol: "answer",
      library: "value.go",
      implementation: { file: join(root, "value.go"), line: 2, column: 6 },
      check: ["go", ["test", "./..."]],
    };
  }
  if (language === "csharp") {
    write(
      "App.csproj",
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net9.0</TargetFramework><OutputType>Exe</OutputType></PropertyGroup></Project>\n',
    );
    write(
      "Value.cs",
      "public interface IValue { int Get(); }\npublic class Value : IValue { public int Get() => 42; }\npublic static class Answers { public static int Answer() => new Value().Get(); }\n",
    );
    const bad =
      'class Program { static void Main() { int result = "wrong"; System.Console.WriteLine(Answers.Answer() + result); } }\n';
    const file = write("Program.cs", bad);
    return {
      file,
      bad,
      good: bad.replace('"wrong"', "0"),
      definition: [1, bad.indexOf("Answer()") + 1],
      symbol: "Answer",
      library: "Value.cs",
      implementation: { file: join(root, "Value.cs"), line: 1, column: 18 },
      check: ["dotnet", ["build", "--nologo"]],
    };
  }
  if (language === "typescript") {
    write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
      }),
    );
    write(
      "package.json",
      JSON.stringify({
        private: true,
        type: "module",
        scripts: { check: "tsc --noEmit" },
      }),
    );
    symlinkSync(
      join(import.meta.dirname, "../node_modules"),
      join(root, "node_modules"),
      "dir",
    );
    write(
      "value.ts",
      "export function answer(): number { return 42; }\nexport interface Value { get(): number }\nexport class Answer implements Value { get(): number { return 42; } }\n",
    );
    const bad =
      'import { answer } from "./value.js";\nexport const result: string = answer();\n';
    const file = write("main.ts", bad);
    return {
      file,
      bad,
      good: bad.replace("result: string", "result: number"),
      definition: [2, 31],
      symbol: "answer",
      library: "value.ts",
      implementation: { file: join(root, "value.ts"), line: 2, column: 18 },
      check: [join(root, "node_modules/.bin/tsc"), ["--noEmit"]],
    };
  }
  if (language === "python") {
    write("pyproject.toml", '[tool.pyright]\ntypeCheckingMode = "strict"\n');
    write("value.py", "def answer() -> int:\n    return 42\n");
    const bad = "from value import answer\nresult: str = answer()\n";
    const file = write("main.py", bad);
    return {
      file,
      bad,
      good: bad.replace("result: str", "result: int"),
      definition: [2, 15],
      symbol: "answer",
      library: "value.py",
      implementation: {
        file: join(root, "value.py"),
        line: 1,
        column: 5,
        unsupported: true,
      },
      check: [join(import.meta.dirname, "../node_modules/.bin/pyright"), ["."]],
    };
  }
  throw new Error(`Unknown fixture ${language}`);
}
