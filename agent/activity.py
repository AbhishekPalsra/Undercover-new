"""Report the model identified in each language-model response."""

from collections.abc import Callable
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import ChatGeneration, LLMResult


def responding_model(result: LLMResult) -> str | None:
    """Read model metadata without treating a router name as a served model."""
    details = [result.llm_output or {}]
    details.extend(
        generation.message.response_metadata
        for group in result.generations
        for generation in group
        if isinstance(generation, ChatGeneration)
    )
    for metadata in details:
        name = metadata.get("model_name") or metadata.get("model")
        if isinstance(name, str) and name and name != "openrouter/free":
            return name
    return None


class ModelActivity(BaseCallbackHandler):
    """Persist model changes while the agent is working."""

    raise_error = True

    def __init__(self, report: Callable[[str, str], None]) -> None:
        self.report = report
        self.previous: str | None = None

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Record the responding model, or explicitly report missing metadata."""
        name = responding_model(response)
        current = name or "unreported"
        if current == self.previous:
            return
        self.previous = current
        if name:
            self.report("model", name)
        else:
            self.report(
                "model_unreported", "The provider did not report the responding model."
            )
