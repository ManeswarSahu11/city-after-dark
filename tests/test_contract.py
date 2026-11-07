from app.models.schemas import AnalyzeResponse
from app.models.schemas import AnalyzeRequest
import pytest
from pydantic import ValidationError


def test_contract_disallows_safety_claims_and_requires_limitations():
    payload = {"routes": [], "parsedPreferences": {}, "safetyClaims": False, "limitations": ["not crime data"], "dataLimitations": ["not crime data"]}
    response = AnalyzeResponse.model_validate(payload)
    assert response.safetyClaims is False
    assert response.limitations


def test_default_route_count_is_three():
    request = AnalyzeRequest(start="Bellandur", destination="Marathahalli")
    assert request.maxRoutes == 3


@pytest.mark.parametrize("field", ["start", "destination"])
@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_blank_places_are_rejected_before_provider_calls(field, blank):
    payload = {"start": "Bellandur", "destination": "Marathahalli", field: blank}
    with pytest.raises(ValidationError, match=f"{field} must not be blank"):
        AnalyzeRequest(**payload)


def test_text_places_are_trimmed_and_coordinates_are_preserved():
    request = AnalyzeRequest(start="  Bellandur  ", destination={"lat": 12.9, "lon": 77.6})
    assert request.start == "Bellandur"
    assert request.destination.lat == 12.9
