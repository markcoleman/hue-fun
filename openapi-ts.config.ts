const config = {
  input: "./openhue.yaml",
  output: "./src/generated",
  plugins: [
    {
      name: "@hey-api/client-fetch",
    },
  ],
};

export default config;
