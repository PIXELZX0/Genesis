import Testing
@testable import Genesis

@Suite(.serialized)
@MainActor
struct OnboardingCoverageTests {
    @Test func `exercise onboarding pages`() {
        OnboardingView.exerciseForTesting()
    }
}
