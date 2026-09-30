Import("env")


def use_rom_loader_without_compression(source, target, env):
    """The ESP ROM loader cannot accept PlatformIO's default -z stream here."""
    flags = [flag for flag in env.get("UPLOADERFLAGS", []) if flag != "-z"]
    env.Replace(UPLOADERFLAGS=flags)


env.AddPreAction("upload", use_rom_loader_without_compression)
