from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.validators import RegexValidator
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Profile

User = get_user_model()

username_validator = RegexValidator(
    r"^[A-Za-z0-9_.-]{3,30}$",
    "Use 3–30 letters, numbers, dots, dashes or underscores.",
)


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email"]
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=30, validators=[username_validator])
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, min_length=8, max_length=128, style={"input_type": "password"})

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        candidate = User(username=attrs["username"], email=attrs["email"])
        try:
            validate_password(attrs["password"], user=candidate)
        except Exception as exc:  # django ValidationError -> DRF field error
            raise serializers.ValidationError({"password": list(getattr(exc, "messages", [str(exc)]))})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data["email"],
            password=validated_data["password"],
        )


class LoginSerializer(TokenObtainPairSerializer):
    """Accepts a username or an email address in the `username` field."""

    default_error_messages = {"no_active_account": "Incorrect username/email or password."}

    def validate(self, attrs):
        identifier = (attrs.get(self.username_field) or "").strip()
        if "@" in identifier:
            match = User.objects.filter(email__iexact=identifier).only("username").first()
            if match:
                attrs[self.username_field] = match.username
        return super().validate(attrs)


class RefreshInputSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False, help_text="Optional for browsers: falls back to the HttpOnly cookie.")


class AccessTokenResponseSerializer(serializers.Serializer):
    access = serializers.CharField()
    access_expires_in = serializers.IntegerField(help_text="Seconds until the access token expires.")
    refresh = serializers.CharField(required=False, help_text="Only returned to non-browser clients.")
    user = UserSummarySerializer(required=False)


class ProfileSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", required=False, max_length=254)
    date_joined = serializers.DateTimeField(source="user.date_joined", read_only=True)
    analysis_count = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = ["id", "username", "email", "display_name", "style_notes", "date_joined", "analysis_count"]

    def get_analysis_count(self, obj) -> int:
        return obj.user.outfit_analyses.count()

    def validate_display_name(self, value):
        return value.strip()

    def validate_style_notes(self, value):
        return value.strip()

    def validate_email(self, value):
        value = value.strip().lower()
        user = self.instance.user
        if User.objects.filter(email__iexact=value).exclude(pk=user.pk).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def update(self, instance, validated_data):
        user_data = validated_data.pop("user", {})
        if "email" in user_data:
            instance.user.email = user_data["email"]
            instance.user.save(update_fields=["email"])
        return super().update(instance, validated_data)
