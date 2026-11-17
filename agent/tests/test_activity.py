from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from agent.activity import ModelActivity


def result(model):
    return LLMResult(
        generations=[[ChatGeneration(message=AIMessage(content="OK"))]],
        llm_output={"model_name": model},
    )


def test_records_actual_routed_models_and_deduplicates_replies():
    events = []
    callback = ModelActivity(lambda action, message: events.append((action, message)))
    callback.on_llm_end(result("provider/first:free"))
    callback.on_llm_end(result("provider/first:free"))
    callback.on_llm_end(result("provider/second:free"))
    assert events == [
        ("model", "provider/first:free"),
        ("model", "provider/second:free"),
    ]


def test_message_metadata_and_missing_model_are_handled_honestly():
    events = []
    callback = ModelActivity(lambda action, message: events.append((action, message)))
    callback.on_llm_end(result("openrouter/free"))
    callback.on_llm_end(result(None))
    message = AIMessage(
        content="OK", response_metadata={"model": "provider/actual:free"}
    )
    callback.on_llm_end(LLMResult(generations=[[ChatGeneration(message=message)]]))
    assert events[0][0] == "model_unreported"
    assert events[1] == ("model", "provider/actual:free")
    assert len(events) == 2
