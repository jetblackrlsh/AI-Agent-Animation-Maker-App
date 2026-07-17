const path = require("path");
const { signAsync } = require("@electron/osx-sign");

exports.default = async function signIndependentMacBuild(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  await signAsync({
    app: appPath,
    platform: "darwin",
    identity: "-",
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile: () => ({ timestamp: "none" }),
  });
};
