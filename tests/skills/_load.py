"""Import a skill script by path: the directories have dashes in their names,
so they are not packages, and the scripts are meant to run as files."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / '.agents' / 'skills'


def load(skill, script):
    path = ROOT / skill / 'scripts' / script
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
